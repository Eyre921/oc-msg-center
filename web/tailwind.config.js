/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Geist",
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        bg: "#ffffff",
        subtle: "#fafafa",
        border: "#ebebeb",
        ink: "#000000",
        muted: "#666666",
        faint: "#8f8f8f",
        accent: "#0070f3",
        success: "#0070f3",
        danger: "#e5484d",
        warn: "#f5a623",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)",
        pop: "0 8px 30px rgba(0,0,0,0.12)",
        focus: "0 0 0 2px rgba(0,112,243,0.35)",
      },
      borderRadius: {
        lg: "10px",
        md: "8px",
      },
      keyframes: {
        in: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { in: "in 0.2s ease-out" },
    },
  },
  plugins: [],
};
