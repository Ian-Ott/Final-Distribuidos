import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

function getClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN no está configurado en .env");
  return new MercadoPagoConfig({ accessToken: token });
}

export function isMpConfigured(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

export function getPublicUrl(): string {
  return (process.env.MP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface CreatePreferenceInput {
  paymentId: string; // nuestro ID interno (para external_reference)
  eventName: string;
  ticketNumber: number;
  amount: number;
  eventId: string;
  buyerEmail: string;
  reservedUntil: Date;
}

export async function createPreference(input: CreatePreferenceInput) {
  const client = getClient();
  const preference = new Preference(client);

  const publicUrl = getPublicUrl();
  // En sandbox no mandamos payer.email: si no coincide con el email del test user
  // logueado en MP, MP rechaza el pago con "No pudimos procesar tu pago".
  // En producción sí conviene pre-cargar el email para mejor UX.
  const isSandbox = (process.env.MP_ACCESS_TOKEN ?? "").includes("TEST") ||
    process.env.MP_PUBLIC_URL?.includes("trycloudflare") ||
    process.env.NODE_ENV !== "production";

  const result = await preference.create({
    body: {
      items: [
        {
          id: `ticket-${input.paymentId}`,
          title: `Entrada — ${input.eventName} (#${input.ticketNumber})`,
          quantity: 1,
          unit_price: input.amount,
          currency_id: "ARS",
        },
      ],
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: input.reservedUntil.toISOString(),
      ...(isSandbox ? {} : { payer: { email: input.buyerEmail } }),
      external_reference: input.paymentId,
      back_urls: {
        success: `${publicUrl}/events/${input.eventId}/payment/result?status=success`,
        failure: `${publicUrl}/events/${input.eventId}/payment/result?status=failure`,
        pending: `${publicUrl}/events/${input.eventId}/payment/result?status=pending`,
      },
      auto_return: "approved",
      notification_url: `${publicUrl}/api/payments/webhook`,
      statement_descriptor: "ENTRADAS BC",
    },
  });

  // Con credenciales nuevas (APP_USR-... de test) hay que usar init_point.
  // sandbox_init_point sólo aplica al modelo viejo (tokens TEST-...).
  const token = process.env.MP_ACCESS_TOKEN ?? "";
  const useInitPoint = token.startsWith("APP_USR-");
  const checkoutUrl = useInitPoint
    ? result.init_point!
    : (result.sandbox_init_point ?? result.init_point!);

  return {
    preferenceId: result.id!,
    initPoint: result.init_point!,
    sandboxInitPoint: result.sandbox_init_point!,
    checkoutUrl,
  };
}

export async function getPaymentInfo(mpPaymentId: string) {
  const client = getClient();
  const payment = new Payment(client);
  const result = await payment.get({ id: mpPaymentId });
  return {
    id: String(result.id),
    status: result.status ?? "unknown",
    statusDetail: result.status_detail ?? "",
    externalReference: result.external_reference ?? "",
    transactionAmount: result.transaction_amount ?? 0,
    currencyId: result.currency_id ?? "ARS",
    payerEmail: result.payer?.email ?? "",
  };
}
