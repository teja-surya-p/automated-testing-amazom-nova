/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Space Grotesk", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"]
      },
      boxShadow: {
        panel: "0 24px 80px rgba(2, 6, 23, 0.45)"
      },
      animation: {
        "pulse-grid": "pulse-grid 8s linear infinite"
      },
      keyframes: {
        "pulse-grid": {
          "0%, 100%": { opacity: "0.14" },
          "50%": { opacity: "0.06" }
        }
      }
    }
  },
  plugins: []
};
