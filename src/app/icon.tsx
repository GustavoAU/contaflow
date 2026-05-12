import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: "6px",
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 14,
            fontWeight: 800,
            fontFamily: "Arial, sans-serif",
            letterSpacing: "-0.5px",
          }}
        >
          CF
        </span>
      </div>
    ),
    { ...size }
  );
}
