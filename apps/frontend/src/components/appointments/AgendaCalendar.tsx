'use client';

import FullCalendar, {
  type CalendarRef,
  type EventInput,
  type EventDisplayInfo,
} from '@fullcalendar/react';
import dayGrid from '@fullcalendar/react/daygrid';
import interaction from '@fullcalendar/react/interaction';
import es from '@fullcalendar/react/locales/es';
import monarch from '@fullcalendar/react/themes/monarch';
import timeGrid from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/monarch/theme.css';
import '@fullcalendar/react/themes/monarch/palettes/blue.css';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  APPOINTMENT_STATUSES,
  appointmentStatusSchema,
  type AppointmentDto,
  type AvailabilityRuleInput,
} from '@turnosmart/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  agendaHours,
  agendaTodayPosition,
  appointmentStates,
  canSelectAgendaTime,
  utcAppointmentDates,
  weekday,
} from '@/lib/agenda';
import { listAgendaAppointments } from '@/lib/agenda-data';
import { errorMessage } from '@/lib/api';
import { businessDate } from '@/lib/booking';
import { appointmentToCalendarEvent } from '@/lib/calendar-events';
import { timezoneLabel } from '@/lib/timezones';
import { useToast } from '@/components/ToastProvider';
import { AppointmentFormDialog } from './AppointmentFormDialog';
import { AppointmentStatusBadge, AppointmentStatusIcon } from './AppointmentStatusBadge';

const plugins = [monarch, dayGrid, timeGrid, interaction];
const toolbar = {
  start: 'prev,next today',
  center: 'title',
  end: 'dayGridMonth,timeGridWeek,timeGridDay',
};
const timeToolbar = { ...toolbar, start: 'prev,next agendaToday' };
const monthToolbar = { ...toolbar, end: 'dayGridMonth' };
type ViewPosition = { date: string; type: string };
type TodayPosition = NonNullable<ReturnType<typeof agendaTodayPosition>>;

function calendarEvent(appointment: AppointmentDto): EventInput {
  const state = appointmentStates[appointment.status];
  return {
    ...appointmentToCalendarEvent(appointment, 'Turno ' + state.label.toLowerCase()),
    color: state.color,
    contrastColor: '#fff',
    className: appointment.status === 'CANCELLED' ? 'agenda-event-cancelled' : '',
    url: '/appointments/' + appointment.id,
  };
}

function renderAppointment({ event, timeText, timeClass, titleClass }: EventDisplayInfo) {
  const status = appointmentStatusSchema.safeParse(event.extendedProps.status);
  return (
    <>
      {timeText && <div className={timeClass}>{timeText}</div>}
      <div
        className={titleClass}
        style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
      >
        {status.success && <AppointmentStatusIcon status={status.data} inEvent />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.title}
        </span>
      </div>
    </>
  );
}

interface Props {
  timezone: string;
  canBook: boolean;
  rules: AvailabilityRuleInput[];
  expanded: boolean;
  appointmentRevision: number;
  onBookingOpenChange(open: boolean): void;
  onToggleExpanded(): void;
  onAppointmentSaved(): void;
}

export function AgendaCalendar({
  timezone,
  canBook,
  rules,
  expanded,
  appointmentRevision,
  onBookingOpenChange,
  onToggleExpanded,
  onAppointmentSaved,
}: Props) {
  const calendar = useRef<CalendarRef>(null);
  const compact = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [draft, setDraft] = useState<{ date?: string; startsAt?: string } | null>(null);
  const { notify } = useToast();
  const [events, setEvents] = useState<EventInput[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [initialPosition] = useState(() => agendaTodayPosition(rules, new Date(), timezone));
  const [viewPosition, setViewPosition] = useState<ViewPosition | null>(null);
  const [todayPosition, setTodayPosition] = useState<TodayPosition | null>(null);
  const lastView = useRef<ViewPosition | null>(null);
  const lastToday = useRef<TodayPosition | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; error: string } | null>(null);
  const requestKey = range ? `${range.from}/${range.to}/${revision}/${appointmentRevision}` : '';
  const loading = !!range && result?.key !== requestKey;
  const error = result?.key === requestKey ? result.error : '';
  const week = useMemo(() => agendaHours(rules), [rules]);
  const hasHours = week.bounds !== null;
  const initialView = !hasHours ? 'dayGridMonth' : compact ? 'timeGridDay' : 'timeGridWeek';
  const viewType = viewPosition?.type ?? initialView;
  const day =
    viewType === 'timeGridDay' ? (viewPosition?.date ?? initialPosition?.date) : undefined;
  const bounds =
    day === undefined ? week.bounds : (agendaHours(rules, weekday(day)).bounds ?? week.bounds);
  const bookable = canBook && hasHours;
  const views = useMemo(
    () => ({
      timeGridWeek: { hiddenDays: hasHours ? week.hiddenDays : [] },
      timeGridDay: { hiddenDays: hasHours ? week.hiddenDays : [] },
    }),
    [hasHours, week.hiddenDays],
  );

  useEffect(() => {
    const instance = calendar.current?.getApi();
    if (!instance) return;

    let active = true;
    let version = 0;
    const syncView = () => {
      const { activeStart, activeEnd, currentStart, type } = instance.view;
      const { from, to } = utcAppointmentDates(activeStart, activeEnd);
      const date = businessDate(
        type === 'timeGridDay' ? currentStart : instance.getDate(),
        timezone,
      );
      const notification = ++version;
      // FullCalendar emite datesSet durante su commit. Publicar fuera de ese ciclo.
      queueMicrotask(() => {
        if (!active || notification !== version) return;
        setRange((previous) =>
          previous?.from === from && previous.to === to ? previous : { from, to },
        );
        setViewPosition((previous) =>
          previous?.date === date && previous.type === type ? previous : { date, type },
        );
      });
    };

    instance.on('datesSet', syncView);
    syncView();
    return () => {
      active = false;
      instance.off('datesSet', syncView);
    };
  }, [timezone]);

  useLayoutEffect(() => {
    const instance = calendar.current?.getApi();
    if (!instance || !viewPosition) return;
    const previous = lastView.current;
    const explicitToday =
      todayPosition && lastToday.current !== todayPosition ? todayPosition : null;

    if (hasHours && viewPosition.type !== 'dayGridMonth') {
      if (explicitToday) {
        // En Semana, cambiar la fecha enfocada puede mantener el mismo rango visible.
        const date =
          viewPosition.type === 'timeGridDay'
            ? viewPosition.date
            : businessDate(instance.getDate(), timezone);
        if (date !== explicitToday.date) return;
        instance.scrollToTime(explicitToday.time);
      } else if (
        previous &&
        (previous.date !== viewPosition.date || previous.type === 'dayGridMonth')
      ) {
        const opening = agendaHours(rules, weekday(viewPosition.date)).bounds ?? week.bounds;
        if (opening) instance.scrollToTime(opening.slotMinTime);
      }
    }
    lastView.current = viewPosition;
    lastToday.current = todayPosition;
  }, [hasHours, rules, timezone, todayPosition, viewPosition, week.bounds]);

  const goToToday = useCallback(() => {
    const position = agendaTodayPosition(rules, new Date(), timezone);
    if (!position) return;
    setTodayPosition(position);
    calendar.current?.getApi().gotoDate(position.date);
  }, [rules, timezone]);

  useEffect(() => {
    if (!hasHours) {
      const instance = calendar.current?.getApi();
      if (instance?.view.type !== 'dayGridMonth') instance?.changeView('dayGridMonth');
    }
  }, [hasHours]);

  useEffect(() => {
    if (!range) return;
    let active = true;
    async function load() {
      if (!range) return;
      const loaded = await listAgendaAppointments(range, () => active);
      if (!active) return;
      setEvents(loaded.map(calendarEvent));
      setResult({ key: requestKey, error: '' });
    }
    void load().catch((err) => {
      if (active) setResult({ key: requestKey, error: errorMessage(err) });
    });
    return () => {
      active = false;
    };
  }, [range, requestKey]);

  function refresh() {
    setRevision((value) => value + 1);
  }

  function canOpenDate(date: string, end?: string) {
    return (
      bookable &&
      date.slice(0, 10) >= businessDate(new Date(), timezone) &&
      canSelectAgendaTime(rules, date, end)
    );
  }

  function openDate(date: string, allDay: boolean) {
    if (!canOpenDate(date)) return;
    const day = date.slice(0, 10);
    changeDraft({ date: day, ...(!allDay ? { startsAt: new Date(date).toISOString() } : {}) });
  }

  function changeDraft(next: typeof draft) {
    setDraft(next);
    onBookingOpenChange(!!next);
  }

  function saved(appointment: AppointmentDto, title: string) {
    calendar.current?.getApi().gotoDate(businessDate(new Date(appointment.startsAt), timezone));
    setEvents((previous) => [
      ...previous.filter((event) => event.id !== appointment.id),
      calendarEvent(appointment),
    ]);
    refresh();
    onAppointmentSaved();
    changeDraft(null);
    notify('Turno guardado · ' + title);
  }

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Typography variant="h2">Calendario de turnos</Typography>
          <Typography variant="body2" color="text.secondary" title={timezone}>
            {timezoneLabel(timezone)}
          </Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            aria-expanded={expanded}
            aria-controls="agenda-calendar-grid"
            startIcon={expanded ? <CloseFullscreenRoundedIcon /> : <OpenInFullRoundedIcon />}
            onClick={onToggleExpanded}
            sx={{ display: { xs: 'none', lg: 'inline-flex' } }}
          >
            {expanded ? 'Contraer calendario' : 'Expandir calendario'}
          </Button>
          {canBook && (
            <Button
              size="small"
              variant="contained"
              startIcon={<AddRoundedIcon />}
              disabled={!bookable}
              onClick={() => changeDraft({})}
            >
              Nuevo turno
            </Button>
          )}
        </Stack>
      </Stack>
      <Stack
        component="section"
        aria-label="Estados de turnos"
        direction="row"
        useFlexGap
        sx={{ gap: 0.75, flexWrap: 'wrap' }}
      >
        {APPOINTMENT_STATUSES.map((status) => (
          <AppointmentStatusBadge key={status} status={status} />
        ))}
      </Stack>
      {!hasHours && (
        <Alert severity="info">
          Todavía no hay horarios de atención configurados. Configurá la disponibilidad en Servicios
          para crear turnos.
        </Alert>
      )}
      {loading && <LinearProgress aria-label="Cargando turnos" />}
      {error && (
        <Alert severity="error" action={<Button onClick={refresh}>Reintentar</Button>}>
          {error}
        </Alert>
      )}
      <Box
        id="agenda-calendar-grid"
        sx={{
          minWidth: 0,
          '& .booking-calendar-toolbar': { flexWrap: 'wrap', gap: 1 },
          '& .booking-calendar-title': { fontSize: { xs: '1rem', sm: '1.25rem' } },
          '& .agenda-day-closed': { bgcolor: 'action.hover' },
          '& .agenda-event-cancelled': { textDecoration: 'line-through' },
          '& .agenda-closed-hours': { bgcolor: 'action.hover' },
        }}
      >
        <FullCalendar
          ref={calendar}
          plugins={plugins}
          locale={es}
          timeZone={timezone}
          initialView={initialView}
          initialDate={initialPosition?.date}
          headerToolbar={
            !hasHours ? monthToolbar : viewType === 'dayGridMonth' ? toolbar : timeToolbar
          }
          buttons={{ agendaToday: { text: 'Hoy', hint: 'Hoy', click: goToToday } }}
          headerToolbarClass="booking-calendar-toolbar"
          toolbarTitleClass="booking-calendar-title"
          dayCellClass={(info) =>
            canSelectAgendaTime(rules, businessDate(info.date, timezone))
              ? 'booking-calendar-day'
              : 'booking-calendar-day agenda-day-closed'
          }
          dayCellTopContent={(info) => (
            <>
              {info.text}
              {info.view.type === 'dayGridMonth' &&
                !canSelectAgendaTime(rules, businessDate(info.date, timezone)) && (
                  <Box
                    component="span"
                    sx={{
                      ml: 0.5,
                      fontSize: '0.65rem',
                      color: 'text.secondary',
                      display: { xs: 'block', sm: 'inline' },
                    }}
                  >
                    Cerrado
                  </Box>
                )}
            </>
          )}
          slotLaneClass="booking-calendar-slot"
          events={events}
          eventContent={renderAppointment}
          height="clamp(360px, calc(100dvh - 360px), 780px)"
          scrollTime={(viewPosition ? bounds?.slotMinTime : initialPosition?.time) ?? '00:00'}
          scrollTimeReset={false}
          {...bounds}
          views={views}
          businessHours={week.businessHours}
          nonBusinessHoursClass="agenda-closed-hours"
          slotEventOverlap={false}
          fixedWeekCount={false}
          dayMaxEvents
          nowIndicator
          allDaySlot={false}
          selectable={bookable}
          selectAllow={(info) => canOpenDate(info.startStr, info.allDay ? undefined : info.endStr)}
          selectMirror
          dateClick={(info) => openDate(info.dateStr, info.allDay)}
          select={(info) => {
            openDate(info.startStr, info.allDay);
            calendar.current?.getApi().unselect();
          }}
          slotDuration="00:30:00"
          snapDuration="00:15:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        />
      </Box>
      {draft && (
        <AppointmentFormDialog
          timezone={timezone}
          {...(draft.date ? { initialDate: draft.date } : {})}
          {...(draft.startsAt ? { initialStartsAt: draft.startsAt } : {})}
          onClose={() => changeDraft(null)}
          onSaved={saved}
        />
      )}
    </Stack>
  );
}
