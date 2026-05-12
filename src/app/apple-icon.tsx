import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#18181b",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 68,
            fontWeight: 800,
            fontFamily: "Arial, sans-serif",
            letterSpacing: "-2px",
          }}
        >
          CF
        </span>
      </div>
    ),
    { ...size }
  );
}
