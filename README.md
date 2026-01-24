# CF Bypass API

A robust Cloudflare bypass API using Puppeteer and Xvfb, designed to be deployed easily with Docker.

## Description

This API provides a way to bypass Cloudflare protection (IUAM and Turnstile) by running a real browser instance. It supports caching to improve performance for repeated requests.

## Prerequisites

-   [Docker](https://docs.docker.com/get-docker/)
-   [Bun](https://bun.sh/) (required for local development)

### Install Bun

If you don't have Bun installed, you can install it via terminal:

**Windows (PowerShell):**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**Linux / macOS:**
```bash
curl -fsSL https://bun.sh/install | bash
```



### Development

To run the project locally, you can use the following commands:

```bash
# Install dependencies
bun install

# Start the server
bun start

# Run tests
bun run test
```

### Install Docker on VPS

If you are using a VPS, you can easily install Docker with the following command:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

## Installation & Deployment

### 1. Build the Docker Image

Navigate to the project directory and run:

```bash
docker build -t cf-bypass .
```

### 2. Run the Container

You can run the container using the standard `docker run` command:

```bash
docker run -d -p 3000:3000 --name cf-bypass cf-bypass
```

The API will be available at `http://localhost:3000`.

### Configuration via Environment Variables

You can configure the service using the following environment variables:

| Variable       | Default | Description                                                                 |
| :------------- | :------ | :-------------------------------------------------------------------------- |
| `PORT`         | `3000`  | The port the server listens on.                                             |

**Example running with custom config:**

```bash
docker run -d --name cf-bypass -p 3000:3000 cf-bypass

```

## API Usage

### Endpoint: `/cloudflare`

**Method:** `POST`

**Body:**

```json
{
    "mode": "iuam", // or "turnstile"
    "url": "https://target-website.com",
    "ttl": 60000 // Optional: Cache time-to-live in ms (Default: 30 mins)
}
```

**Response:**

```json
{
    "code": 200,
    "token": "...",
    "cookies": [...],
    "elapsed": "1.23s"
}
```
