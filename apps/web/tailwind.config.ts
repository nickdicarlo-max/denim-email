import { tailwindExtend } from "@denim/types/design-tokens";
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      ...(tailwindExtend as Record<string, unknown>),
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease",
      },
      fontSize: {
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "16px" }],
        base: ["14px", { lineHeight: "20px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["17px", { lineHeight: "24px" }],
        xl: ["20px", { lineHeight: "28px" }],
      },
    },
  },
  plugins: [],
};
export default config;
