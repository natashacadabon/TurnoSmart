import type { AppointmentEmailKind } from '@prisma/client';
import { z } from 'zod';

export const appointmentEmailData = z.object({
  business: z.string(),
  customer: z.string(),
  service: z.string(),
  startsAt: z.iso.datetime(),
  timezone: z.string(),
  previousStartsAt: z.iso.datetime().optional(),
  professional: z.string().optional(),
});
type AppointmentEmailData = z.infer<typeof appointmentEmailData>;

const copy: Record<AppointmentEmailKind, { title: string; description: string }> = {
  BOOKED: { title: 'Tu turno está reservado', description: 'Estos son los datos de tu reserva.' },
  CONFIRMED: {
    title: 'Tu asistencia está confirmada',
    description: 'Te esperamos en el horario acordado.',
  },
  CANCELLED: {
    title: 'Tu turno fue cancelado',
    description: 'La reserva de este horario fue cancelada.',
  },
  RESCHEDULED: {
    title: 'Tu turno fue reprogramado',
    description: 'Agendá el nuevo horario de tu reserva.',
  },
  RESCHEDULE_DECLINED: {
    title: 'Tu turno mantiene su horario',
    description:
      'El negocio rechazó la solicitud de reprogramación. Tu reserva original sigue vigente.',
  },
  REMINDER_48H: {
    title: 'Recordatorio de tu turno',
    description: 'Tu turno se acerca. Revisá los datos de tu reserva.',
  },
  REMINDER_24H: {
    title: 'Recordatorio de tu turno',
    description: 'Tu turno se acerca. Revisá los datos de tu reserva.',
  },
  REMINDER: {
    title: 'Recordatorio de tu turno',
    description: 'Tu turno se acerca. Revisá los datos de tu reserva.',
  },
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

export function renderAppointmentEmail(
  kind: AppointmentEmailKind,
  data: AppointmentEmailData,
  links: { label: string; url: string }[] = [],
) {
  const { title, description } = copy[kind];
  const date = new Date(data.startsAt);
  const dateFormat = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeZone: data.timezone,
  });
  const timeFormat = new Intl.DateTimeFormat('es-AR', {
    timeStyle: 'short',
    timeZone: data.timezone,
    hourCycle: 'h23',
  });
  const city = (data.timezone.split('/').pop() ?? data.timezone).replace(/_/g, ' ');
  const offset = new Intl.DateTimeFormat('es-AR', {
    timeZone: data.timezone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')!
    .value.replace('GMT', 'UTC');
  const timezone = city === offset ? city : `${city} (${offset})`;
  const details = [
    ['Negocio', data.business],
    ['Cliente', data.customer],
    ['Servicio', data.service],
    ['Fecha', dateFormat.format(date)],
    ['Hora', timeFormat.format(date)],
    ['Zona horaria', timezone],
  ];
  if (data.professional) details.push(['Profesional', data.professional]);
  if (data.previousStartsAt) {
    const previous = new Date(data.previousStartsAt);
    details.push([
      'Horario anterior',
      `${dateFormat.format(previous)} · ${timeFormat.format(previous)}`,
    ]);
  }
  const detailHtml = details
    .map(
      ([label, value]) =>
        `<tr><th scope="row" width="96" style="width:96px;text-align:left;padding:5px 12px 5px 0;color:#64748B;font-size:12px;font-weight:normal;vertical-align:top;line-height:20px">${label}</th><td style="padding:5px 0;color:#0F172A;font-size:14px;line-height:20px;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(value!)}</td></tr>`,
    )
    .join('');
  const styles: Record<
    string,
    { order: number; background: string; color: string; border: string }
  > = {
    'Confirmar asistencia': {
      order: 0,
      background: '#15803D',
      color: '#FFFFFF',
      border: '#15803D',
    },
    'Solicitar reprogramación': {
      order: 1,
      background: '#FFFFFF',
      color: '#2563EB',
      border: '#2563EB',
    },
    'Cancelar turno': { order: 2, background: '#FFFFFF', color: '#DC2626', border: '#DC2626' },
  };
  // Presentation only: preserve every supplied URL and never add an unavailable action.
  const orderedLinks = [...links].sort(
    (a, b) => (styles[a.label]?.order ?? 3) - (styles[b.label]?.order ?? 3),
  );
  const linksHtml = orderedLinks
    .map(({ label, url }) => {
      const action = styles[label] ?? {
        background: '#FFFFFF',
        color: '#2563EB',
        border: '#2563EB',
      };
      return `<tr><td style="padding-top:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" height="42" bgcolor="${action.background}" style="height:42px;background-color:${action.background};border:1px solid ${action.border};border-radius:8px;mso-padding-alt:0;text-align:center"><a class="action" href="${escapeHtml(url)}" style="display:block;padding:0 8px;border-radius:8px;color:${action.color};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:42px;mso-line-height-rule:exactly;text-align:center;text-decoration:none;white-space:nowrap">${escapeHtml(label)}</a></td></tr></table></td></tr>`;
    })
    .join('');
  return {
    subject: title,
    text: [
      title,
      `Hola, ${data.customer}.`,
      description,
      ...details.map(([label, value]) => `${label}: ${value}`),
      ...orderedLinks.map(({ label, url }) => `${label}: ${url}`),
      'TurnoSmart',
    ].join('\n'),
    html: `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>@media only screen and (max-width:480px){.content{padding:20px!important}.email-title{font-size:22px!important;line-height:28px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#F6F8FB;color:#0F172A;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FB"><tr><td align="center" style="padding:20px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:4px solid #2563EB;border-radius:12px;border-collapse:separate;text-align:left">
<tr><td class="content" style="padding:24px">
<p style="margin:0 0 16px;color:#2563EB;font-size:16px;line-height:24px;font-weight:bold">TurnoSmart</p>
<h1 class="email-title" style="font-size:24px;line-height:30px;margin:0 0 12px;color:#0F172A">${title}</h1>
<p style="margin:0 0 4px;color:#334155;font-size:14px;line-height:22px">Hola, ${escapeHtml(data.customer)}.</p>
<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:22px">${description}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px"><tr><td style="padding:12px 16px"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${detailHtml}</table></td></tr></table>
${linksHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px">${linksHtml}</table>` : ''}
</td></tr>
<tr><td align="center" style="padding:16px 24px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px;line-height:18px">Enviado con <strong style="color:#475569">TurnoSmart</strong></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`,
  };
}
