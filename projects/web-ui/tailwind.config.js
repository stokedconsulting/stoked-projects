/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        github: {
          bg: '#0d1117',
          card: '#161b22',
          border: '#21262d',
          hover: '#1c2128',
          secondary: '#161b22',
          muted: '#8b949e',
          text: '#e6edf3',
          'text-muted': '#8b949e',
          'text-dim': '#484f58',
        },
        accent: {
          blue: '#58a6ff',
          green: '#3fb950',
          amber: '#d29922',
          red: '#f85149',
          gray: '#6e7681',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
