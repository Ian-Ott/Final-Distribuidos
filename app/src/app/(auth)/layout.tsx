export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-[420px]">{children}</div>
    </div>
  );
}
