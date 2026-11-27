// Genera las plantillas de correo de Supabase Auth con el mismo diseño que los correos de turnos
// (packages/shared/src/email-templates.ts): barra azul, marca TurnoSmart y botón principal.
// Uso: node infra/supabase/email-templates/build.mjs
// Las variables {{ .X }} las completa Supabase Auth (GoTrue) al enviar.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

/** Asunto de cada correo: copiar también en Supabase → Authentication → Email Templates. */
export const SUBJECTS = {
  confirmation: 'Confirmá tu correo en TurnoSmart',
  recovery: 'Restablecé tu contraseña de TurnoSmart',
  invite: 'Te invitaron a administrar un negocio en TurnoSmart',
  email_change: 'Confirmá tu nuevo correo en TurnoSmart',
};

const templates = {
  confirmation: {
    title: 'Confirmá tu correo',
    intro: 'Recibimos el registro de <strong>{{ .Email }}</strong> en TurnoSmart.',
    body: 'Confirmá tu correo para activar la cuenta. Después vas a ingresar el token de invitación que te dio el administrador de la plataforma.',
    action: 'Confirmar correo',
    expiry: 'El enlace vence en 1 hora y se puede usar una sola vez.',
    ignore: 'Si no creaste una cuenta, ignorá este correo: no se va a activar nada.',
  },
  recovery: {
    title: 'Restablecé tu contraseña',
    intro: 'Pediste restablecer la contraseña de <strong>{{ .Email }}</strong>.',
    body: 'Usá el botón para definir una contraseña nueva. Tiene que tener al menos 10 caracteres, con letras y números.',
    action: 'Definir nueva contraseña',
    expiry: 'El enlace vence en 1 hora y se puede usar una sola vez.',
    ignore: 'Si no lo pediste, ignorá este correo: tu contraseña actual sigue funcionando.',
  },
  invite: {
    title: 'Te invitaron a TurnoSmart',
    intro:
      'El administrador de la plataforma te invitó como dueño/a de un negocio con <strong>{{ .Email }}</strong>.',
    body: 'Aceptá la invitación y creá tu contraseña para entrar a la agenda, los clientes y los servicios de tu negocio.',
    action: 'Aceptar invitación',
    expiry: 'La invitación vence en 1 hora. Si venció, pedí que te la reenvíen.',
    ignore: 'Si no esperabas esta invitación, ignorá este correo.',
  },
  email_change: {
    title: 'Confirmá tu nuevo correo',
    intro: 'Pediste cambiar el correo de tu cuenta a <strong>{{ .NewEmail }}</strong>.',
    body: 'Confirmá el cambio para empezar a usar la nueva dirección al iniciar sesión.',
    action: 'Confirmar nuevo correo',
    expiry: 'El enlace vence en 1 hora y se puede usar una sola vez.',
    ignore: 'Si no pediste este cambio, ignorá este correo y revisá tu contraseña.',
  },
};

function render({ title, intro, body, action, expiry, ignore }) {
  return `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>@media only screen and (max-width:480px){.content{padding:20px!important}.email-title{font-size:22px!important;line-height:28px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#F6F8FB;color:#0F172A;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FB"><tr><td align="center" style="padding:20px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:4px solid #2563EB;border-radius:12px;border-collapse:separate;text-align:left">
<tr><td class="content" style="padding:24px">
<p style="margin:0 0 2px;color:#2563EB;font-size:16px;line-height:24px;font-weight:bold">TurnoSmart</p>
<p style="margin:0 0 16px;color:#64748B;font-size:12px;line-height:18px">Agenda inteligente</p>
<h1 class="email-title" style="font-size:24px;line-height:30px;margin:0 0 12px;color:#0F172A">${title}</h1>
<p style="margin:0 0 8px;color:#334155;font-size:14px;line-height:22px">${intro}</p>
<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:22px">${body}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" height="44" bgcolor="#2563EB" style="height:44px;background-color:#2563EB;border:1px solid #2563EB;border-radius:8px;mso-padding-alt:0;text-align:center"><a href="{{ .ConfirmationURL }}" style="display:block;padding:0 8px;border-radius:8px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:44px;mso-line-height-rule:exactly;text-align:center;text-decoration:none;white-space:nowrap">${action}</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px"><tr><td style="padding:12px 16px;color:#475569;font-size:13px;line-height:20px">
<p style="margin:0 0 8px">${expiry}</p>
<p style="margin:0;color:#64748B;font-size:12px;line-height:18px">¿El botón no funciona? Copiá este enlace en el navegador:<br><a href="{{ .ConfirmationURL }}" style="color:#2563EB;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">{{ .ConfirmationURL }}</a></p>
</td></tr></table>
<p style="margin:16px 0 0;color:#64748B;font-size:12px;line-height:18px">${ignore}</p>
</td></tr>
<tr><td align="center" style="padding:16px 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px;line-height:18px">Enviado con <strong style="color:#475569">TurnoSmart</strong> · <a href="{{ .SiteURL }}" style="color:#64748B;text-decoration:underline">Ir a TurnoSmart</a></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>
`;
}

for (const [name, content] of Object.entries(templates)) {
  writeFileSync(`${dir}${name}.html`, render(content));
}
console.log(`Plantillas generadas: ${Object.keys(templates).join(', ')}`);
