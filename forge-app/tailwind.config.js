/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'testplanit': {
          blue: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
          gray: '#6b7280',
          border: '#e5e7eb'
        }
      }
    },
  },
  plugins: [],
}