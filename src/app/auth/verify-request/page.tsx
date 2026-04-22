export default function VerifyRequestPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: 32,
        textAlign: "center",
      }}
    >
      <h1>Check your email</h1>
      <p>A sign-in link has been sent to your inbox. The link expires in 24 hours.</p>
    </main>
  );
}
