import { ResetPasswordForm } from '@/components/reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="surface-deep-gradient flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="gold-hairline mx-auto mb-5 w-24" />
          <h1 className="font-display text-4xl font-medium tracking-tight text-white">Conselho</h1>
          <div className="gold-hairline mx-auto mt-5 w-24" />
        </div>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="card-premium space-y-2 p-8 text-center">
            <p className="text-sm text-ink">Link inválido — falta o token de recuperação.</p>
          </div>
        )}
      </div>
    </main>
  );
}
