module.exports = {
  apps: [{
    name: 'dashboard-api',
    script: 'src/index.js',
    cwd: '/var/www/app/current/api',
    node_args: '--experimental-vm-modules',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      SESSION_FILE: '/var/www/app/garmin-session.json',
    },
    max_restarts: 5,
    restart_delay: 3000,
    merge_logs: true,
    error_file: '/var/log/pm2/dashboard-api-error.log',
    out_file: '/var/log/pm2/dashboard-api-out.log',
  }],
}
