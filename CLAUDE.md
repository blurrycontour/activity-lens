## Development
The development of the app needs to happen in a maintainable and efficient way. At any point in time, if you come across bad implementation or better ideas, do let me know and then the way forward can be decided. This app is intended for long-term use by several users, on both mobile and desktop. Add test cases with low cost and high impact, whenever some important, fragile or security functionality is added.

Less code is better than lot of sloppy code. Avoid unnecessary complexity and keep the codebase clean and maintainable. Always write code with future developers in mind, including yourself. Work in a branch and make modular commits. Create a new branch as needed.

IMPORTANT: If there are multiple ways to implement a major or medium feature, show me the options along with pros and cons of each approach, so that we can decide the best way forward.

### Frontend
Stack: React + Vite + Tailwind CSS
Folder: /frontend

Always keep in mind that UI components should be reusable and should work well both on desktop and mobile devices. Use Tailwind's responsive utilities to handle different screen sizes. Make sure the design is consistent across the app.

### Backend
Stack: Golang
Folder: /backend

Keep in mind that this project would be used by handful number of active users over several years. So make functions and API calls efficient from the start. Keep the best practices in mind. Avoid unnecessary database calls and avoid loading large data into memory.

### Database
Stack: Sqlite OR Postgres

Currently project uses Sqlite for simplicity, but all the backend should be compatible with Postgres as well, to be able to switch at any time in future.


## Deployment
Deployment will be typically via docker compose and a local instance is running on port 9090.
