## Authentication and Authorization

The backend uses the blurrycontour/go-authkit module for authentication and authorization, including OIDC support. It's available locally at ../go-authkit.

## Development
Keep in mind that this project would be used by handful number of active users over several years. So make functions and API calls efficient from the start. Keep the best practices in mind. Avoid unnecessary database calls and avoid loading large data into memory. Use streaming where possible.
