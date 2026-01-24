# Deploying to Heroku with Docker

This guide explains how to deploy this application to Heroku using Docker.

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- [Docker](https://docs.docker.com/get-docker/) installed and running
- A Heroku account

## Deployment Steps

1.  **Login to Heroku**

    Open your terminal and log in to your Heroku account:
    ```bash
    heroku login
    ```

    Then, log in to the Heroku Container Registry:
    ```bash
    heroku container:login
    ```

2.  **Create a New Heroku App**

    **Deploying to a Team:**
    If you are deploying to a Heroku Team, specify the team name:
    ```bash
    heroku create cf-bypass --team pspkcloudbots
    ```

3.  **Set Stack to Container**

    Ensure the Heroku app is set to use the container stack:
    ```bash
    heroku stack:set container -a cf-bypass
    ```

4.  **Push the Docker Image**

    Build and push the Docker image to Heroku:
    ```bash
    heroku container:push web -a cf-bypass
    ```

5.  **Release the Application**

    Release the newly pushed image to deploy your app:
    ```bash
    heroku container:release web -a cf-bypass
    ```

## Configuration (Environment Variables)

You can configure the application using environment variables. The following variables are available:

-   `authToken`: (Optional) Token for authorization.
-   `browserLimit`: (Optional) Maximum number of concurrent browser instances (default: `20`).
-   `timeOut`: (Optional) Timeout for operations in milliseconds (default: `60000`).

To set an environment variable, use the following command:

```bash
heroku config:set authToken=your_secret_token -a cf-bypass
heroku config:set browserLimit=10 -a cf-bypass
```

## Useful Commands

-   **View Logs**: Monitor your application logs in real-time.
    ```bash
    heroku logs --tail -a cf-bypass
    ```

-   **Open App**: Open the deployed application in your browser.
    ```bash
    heroku open -a cf-bypass
    ```
