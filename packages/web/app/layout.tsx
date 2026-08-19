export const metadata = {
  title: "Media Vault",
  description: "Private cloud storage and media vault",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#000", color: "#eee", fontFamily: "sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
