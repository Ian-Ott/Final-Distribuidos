import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-20">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight">
          Entradas en blockchain, sin fricción.
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Cada entrada es un activo único registrado en una blockchain distribuida.
          Un solo dueño, una sola vez.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/events"
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-5 py-2.5 text-sm font-medium"
          >
            Ver eventos
          </Link>
          <Link
            href="/register"
            className="rounded-md border border-black/10 dark:border-white/10 px-5 py-2.5 text-sm font-medium"
          >
            Soy organizador
          </Link>
        </div>
      </div>
    </div>
  );
}
