#!/usr/bin/env python3
"""
SRP Proofs API - Exposes compute_srp_proofs as an HTTP endpoint.

Usage:
    pip install flask bcrypt
    python srp_api.py

Endpoint:
    POST /compute
    Body (JSON):
        {
            "auth_info": "<raw JSON string or object>",
            "username": "user@example.com",
            "password": "yourpassword"
        }

    Response (JSON):
        {
            "ClientEphemeral": "base64...",
            "ClientProof": "base64...",
            "ExpectedServerProof": "base64..."
        }
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import sys
from typing import Any

import bcrypt
from flask import Flask, jsonify, request

app = Flask(__name__)

BCRYPT_PREFIX = b"$2y$10$"
BCRYPT_ALPHABET = b"./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def sha512_expand(seed: bytes) -> bytes:
    blocks = []
    for counter in range(4):
        blocks.append(hashlib.sha512(seed + bytes([counter])).digest())
    return b"".join(blocks)


def normalize_username(value: str) -> str:
    return value.replace(".", "").replace("-", "").replace("_", "").lower()


def bcrypt_base64_encode(data: bytes, length: int) -> str:
    if length <= 0 or length > len(data):
        raise ValueError("Invalid length for bcrypt base64 encoding")

    output = []
    offset = 0
    while offset < length:
        c1 = data[offset]
        offset += 1
        output.append(BCRYPT_ALPHABET[(c1 >> 2) & 0x3F])
        c1 = (c1 & 0x03) << 4
        if offset >= length:
            output.append(BCRYPT_ALPHABET[c1 & 0x3F])
            break

        c2 = data[offset]
        offset += 1
        c1 |= (c2 >> 4) & 0x0F
        output.append(BCRYPT_ALPHABET[c1 & 0x3F])
        c1 = (c2 & 0x0F) << 2
        if offset >= length:
            output.append(BCRYPT_ALPHABET[c1 & 0x3F])
            break

        c2 = data[offset]
        offset += 1
        c1 |= (c2 >> 6) & 0x03
        output.append(BCRYPT_ALPHABET[c1 & 0x3F])
        output.append(BCRYPT_ALPHABET[c2 & 0x3F])
    return bytes(output).decode("ascii")


def to_bigint_be(raw: bytes) -> int:
    if not raw:
        return 0
    return int.from_bytes(raw, byteorder="big", signed=False)


def to_bigint_le(raw: bytes) -> int:
    return to_bigint_be(raw[::-1])


def to_bytes(value: int, *, order: str = "be", size: int | None = None) -> bytes:
    if value < 0:
        raise ValueError("Negative values are not supported")
    length = max(1, (value.bit_length() + 7) // 8)
    out = value.to_bytes(length, byteorder="big", signed=False)
    if size is not None:
        out = out.rjust(size, b"\x00")
    if order == "le":
        out = out[::-1]
    elif order != "be":
        raise ValueError("order must be 'be' or 'le'")
    return out


def mod(value: int, modulus: int) -> int:
    result = value % modulus
    if result < 0:
        result += modulus
    return result


def extract_signed_modulus_b64(signed_modulus: str) -> str:
    marker_start = "-----BEGIN PGP SIGNED MESSAGE-----"
    marker_sig = "-----BEGIN PGP SIGNATURE-----"
    if marker_start not in signed_modulus or marker_sig not in signed_modulus:
        raise ValueError("Invalid signed modulus format")
    body = signed_modulus.split("\n\n", 1)[1]
    base64_part = body.split(marker_sig, 1)[0].strip()
    if not base64_part:
        raise ValueError("No modulus payload found in signed modulus")
    return base64_part


def srp_password_hash(
    *,
    version: int,
    password: str,
    salt_b64: str | None,
    username: str | None,
    modulus_bytes: bytes,
) -> bytes:
    def t_hash(password_value: str, bcrypt_salt_suffix: str) -> bytes:
        salt = BCRYPT_PREFIX + bcrypt_salt_suffix.encode("ascii")
        hashed = bcrypt.hashpw(password_value.encode("utf-8"), salt)
        return sha512_expand(hashed + modulus_bytes)

    if version in (3, 4):
        if not salt_b64:
            raise ValueError("Missing SRP salt for auth version >=3")
        salt_bytes = base64.b64decode(salt_b64)
        seed = salt_bytes + b"proton"
        if len(seed) != 16:
            raise ValueError("Invalid salt seed length for Proton bcrypt derivation")
        salt_suffix = bcrypt_base64_encode(seed, 16)
        return t_hash(password, salt_suffix)

    if version == 2:
        if not username:
            raise ValueError("Missing username for auth version 2")
        md5_source = normalize_username(username).lower().encode("utf-8")
        suffix = hashlib.md5(md5_source).hexdigest()
        return t_hash(password, suffix)

    if version == 1:
        if not username:
            raise ValueError("Missing username for auth version 1")
        suffix = hashlib.md5(username.lower().encode("utf-8")).hexdigest()
        return t_hash(password, suffix)

    if version == 0:
        if not username:
            raise ValueError("Missing username for auth version 0")
        mix = (username.lower() + password).encode("utf-8")
        legacy = base64.b64encode(hashlib.sha512(mix).digest()).decode("ascii")
        suffix = hashlib.md5(username.lower().encode("utf-8")).hexdigest()
        return t_hash(legacy, suffix)

    raise ValueError(f"Unsupported auth version: {version}")


def generate_safe_client_values(byte_length: int, modulus: int, server_ephemeral: bytes) -> tuple[int, int, int]:
    generator = 2
    for _ in range(1000):
        client_secret = to_bigint_le(secrets.token_bytes(byte_length))
        client_ephemeral = pow(generator, client_secret, modulus)
        client_ephemeral_le = to_bytes(client_ephemeral, order="le", size=byte_length)
        scrambling_param = to_bigint_le(sha512_expand(client_ephemeral_le + server_ephemeral))
        if scrambling_param != 0 and client_ephemeral != 0:
            return client_secret, client_ephemeral, scrambling_param
    raise RuntimeError("Could not generate safe SRP client parameters")


def compute_srp_proofs(auth_info: dict[str, Any], *, username: str, password: str) -> dict[str, str]:
    version = int(auth_info["Version"])
    signed_modulus = auth_info["Modulus"]
    server_ephemeral_b64 = auth_info["ServerEphemeral"]

    signed_username = auth_info.get("Username")
    if version <= 2 and signed_username and username.lower() != signed_username.lower():
        raise ValueError("Username mismatch with server-provided auth info")

    modulus_payload_b64 = extract_signed_modulus_b64(signed_modulus)
    modulus_bytes = base64.b64decode(modulus_payload_b64)
    server_ephemeral = base64.b64decode(server_ephemeral_b64)
    hashed_password = srp_password_hash(
        version=version,
        password=password,
        salt_b64=auth_info.get("Salt"),
        username=signed_username if version < 3 else None,
        modulus_bytes=modulus_bytes,
    )

    byte_length = 256
    modulus_int = to_bigint_le(modulus_bytes)
    if len(to_bytes(modulus_int, order="be")) != byte_length:
        raise ValueError("SRP modulus has incorrect size")

    generator = 2
    multiplier_hash = sha512_expand(to_bytes(generator, order="le", size=byte_length) + modulus_bytes)
    multiplier = to_bigint_le(multiplier_hash)
    server_ephemeral_int = to_bigint_le(server_ephemeral)
    password_int = to_bigint_le(hashed_password)
    modulus_minus_one = modulus_int - 1

    if server_ephemeral_int == 0:
        raise ValueError("SRP server ephemeral is out of bounds")

    client_secret, client_ephemeral, scrambling = generate_safe_client_values(
        byte_length, modulus_int, server_ephemeral
    )

    k_mod = mod(multiplier, modulus_int)
    gx = mod(pow(generator, password_int, modulus_int) * k_mod, modulus_int)
    exponent = mod(scrambling * password_int + client_secret, modulus_minus_one)
    base = mod(server_ephemeral_int - gx, modulus_int)
    shared_session_int = pow(base, exponent, modulus_int)

    client_ephemeral_bytes = to_bytes(client_ephemeral, order="le", size=byte_length)
    shared_session_bytes = to_bytes(shared_session_int, order="le", size=byte_length)
    client_proof = sha512_expand(client_ephemeral_bytes + server_ephemeral + shared_session_bytes)
    expected_server_proof = sha512_expand(client_ephemeral_bytes + client_proof + shared_session_bytes)

    return {
        "ClientEphemeral": base64.b64encode(client_ephemeral_bytes).decode("ascii"),
        "ClientProof": base64.b64encode(client_proof).decode("ascii"),
        "ExpectedServerProof": base64.b64encode(expected_server_proof).decode("ascii"),
        "SRPSession": auth_info.get("SRPSession", ""),
    }


@app.route("/compute", methods=["POST"])
def compute_endpoint():
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON body"}), 400

    if not body:
        return jsonify({"error": "Empty request body"}), 400

    auth_info_raw = body.get("auth_info")
    username = body.get("username")
    password = body.get("password")

    if not auth_info_raw or not username or not password:
        return jsonify({"error": "Missing required fields: auth_info, username, password"}), 400

    if isinstance(auth_info_raw, str):
        try:
            auth_info = json.loads(auth_info_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "auth_info is not valid JSON"}), 400
    elif isinstance(auth_info_raw, dict):
        auth_info = auth_info_raw
    else:
        return jsonify({"error": "auth_info must be a JSON string or object"}), 400

    required_fields = ["Version", "Modulus", "ServerEphemeral", "SRPSession"]
    for field in required_fields:
        if field not in auth_info:
            return jsonify({"error": f"auth_info missing required field: {field}"}), 400

    try:
        result = compute_srp_proofs(auth_info, username=username, password=password)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    port = 5000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    print(f"SRP Proofs API running on http://0.0.0.0:{port}")
    print(f"POST /compute - Compute SRP proofs")
    print(f"GET  /health  - Health check")
    app.run(host="0.0.0.0", port=port, debug=False)
