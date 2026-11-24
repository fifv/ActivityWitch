import { defineConfig } from 'vite'

// ActivityWatch authorizes an exact browser origin, including hostname and port.
const localServer = {
  host: 'localhost',
  port: 5177,
  strictPort: true,
  cors: false,
}

export default defineConfig({ server: localServer, preview: localServer })
