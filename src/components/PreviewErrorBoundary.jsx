import React from "react";

/** Preview-only safety net: never leave the test homepage silently blank. */
export default class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("N64 preview rendering error:", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#ddf8ff",
          color: "#20345c",
          padding: "15vh 20px 50px",
          textAlign: "center",
          fontFamily: "Verdana, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            padding: "28px 22px",
            border: "5px solid #20345c",
            background: "#fff9e8",
            boxShadow: "8px 9px 0 #79a7bd",
          }}
        >
          <h1 style={{ fontSize: "1.65rem", fontWeight: 900, margin: "0 0 14px" }}>
            PREVIEW LOADING ERROR
          </h1>
          <p style={{ fontSize: "1rem", lineHeight: 1.6, margin: "0 0 22px" }}>
            This is a problem with the test version, not your booking.
            Try reloading the preview.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 52,
              padding: "10px 20px",
              background: "#ffda43",
              color: "#20345c",
              border: "4px solid #20345c",
              borderRadius: 0,
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            RELOAD PREVIEW
          </button>
        </div>
      </main>
    );
  }
}
