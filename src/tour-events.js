(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfTourEvents = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  const textValid = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  function formatter(timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  }
  function partsAt(date, format) {
    return Object.fromEntries(format.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  }
  function todayInZone(timeZone, now = new Date()) {
    const parts = partsAt(now, formatter(timeZone)); return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function teeTimeInstant(date, time, timeZone, ambiguity = 'reject') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Ange ett giltigt datum och klockslag.');
    const target = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) throw new Error('Ogiltigt datum.');
    let format;
    try { format = formatter(timeZone); } catch (_) { throw new Error('Ange en giltig tidszon, till exempel Europe/Stockholm.'); }
    const offsets = new Set();
    for (let h = -36; h <= 36; h += 6) {
      const sample = target + h * 3600000, parts = partsAt(new Date(sample), format);
      offsets.add(Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) - sample);
    }
    const candidates = [...offsets].map(offset => target - offset).filter(value => {
      const p = partsAt(new Date(value), format); return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
    });
    if (candidates.length > 1 && ambiguity === 'latest') return Math.max(...candidates);
    if (candidates.length !== 1) throw new Error('Starttiden saknas eller förekommer två gånger vid tidsomställningen. Välj en annan tid.');
    return candidates[0];
  }
  function endOfDay(date, timeZone) {
    try { return teeTimeInstant(date, '23:59', timeZone, 'latest') + 60000; }
    catch (_) {
      // Some zones skip their last hour. Use the first valid start of the next
      // local day, rather than closing before a scheduled playing day ends.
      const next = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
      for (let hour = 0; hour < 24; hour++) {
        try { return teeTimeInstant(next, String(hour).padStart(2, '0') + ':00', timeZone, 'latest'); } catch (_) {}
      }
      throw new Error('Kunde inte fastställa speldagens slut i vald tidszon.');
    }
  }
  function validateEvent(event, tour) {
    const allowed = new Set(['name', 'date', 'timeZone', 'courseId', 'note', 'status', 'groups']);
    if (!event || Array.isArray(event) || Object.keys(event).some(key => !allowed.has(key)) || !textValid(event.name, 80)) return 'Ange ett namn, högst 80 tecken.';
    if (typeof event.date !== 'string' || event.date < tour.startDate || event.date > tour.endDate) return 'Speldatum måste ligga inom tourens spelperiod.';
    if (!tour.courses.some(course => course.id === event.courseId)) return 'Välj en bana i touren.';
    if (!['scheduled', 'cancelled'].includes(event.status)) return 'Ogiltig schemastatus.';
    if (typeof event.timeZone !== 'string' || event.timeZone.length > 80 || !event.timeZone.trim()) return 'Ange tidszon.';
    if (typeof event.note !== 'string' || event.note.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(event.note)) return 'Informationen får vara högst 500 tecken.';
    if (!Array.isArray(event.groups) || !event.groups.length || event.groups.length > 25) return 'Lägg till 1–25 grupper.';
    const groups = new Set(), members = new Set();
    for (const group of event.groups) {
      if (!group || Object.keys(group).some(key => !['id', 'name', 'teeTime', 'memberIds'].includes(key)) || !idValid(group.id) || groups.has(group.id) || !textValid(group.name, 50)) return 'Varje grupp behöver ett unikt ID och ett namn.';
      groups.add(group.id);
      if (!Array.isArray(group.memberIds) || !group.memberIds.length || group.memberIds.length > 4) return 'Varje grupp måste ha 1–4 spelare.';
      for (const id of group.memberIds) {
        if (!tour.members.some(member => member.id === id) || members.has(id)) return 'En spelare får endast finnas i en grupp per speldag.';
        members.add(id);
      }
      try { teeTimeInstant(event.date, group.teeTime, event.timeZone); } catch (error) { return error.message; }
    }
    return null;
  }
  function myStarts(events, memberId) {
    return (events || []).filter(event => event.status === 'scheduled').flatMap(event => event.groups.filter(group => group.memberIds.includes(memberId)).map(group => ({ event, group })))
      .sort((a, b) => teeTimeInstant(a.event.date, a.group.teeTime, a.event.timeZone) - teeTimeInstant(b.event.date, b.group.teeTime, b.event.timeZone));
  }
  const escapeText = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const utc = value => new Date(value).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  function foldLine(line) {
    const encoder = new TextEncoder(); let output = '', part = '', size = 0;
    for (const char of line) { const bytes = encoder.encode(char).length; if (size + bytes > 75) { output += part + '\r\n'; part = ' '; size = 1; } part += char; size += bytes; }
    return output + part;
  }
  function calendar(event, group, tour, code, appUrl) {
    if (!idValid(event.id) || !idValid(group.id) || !/^[A-HJ-KM-NP-Z2-9]{8}$/.test(code)) throw new Error('Ogiltig kalenderidentitet.');
    const start = teeTimeInstant(event.date, group.teeTime, event.timeZone), course = tour.courses.find(item => item.id === event.courseId);
    const players = group.memberIds.map(id => tour.members.find(member => member.id === id)?.name).filter(Boolean);
    const link = new URL(appUrl); if (!['https:', 'http:'].includes(link.protocol)) throw new Error('Ogiltig applänk.'); link.search = ''; link.hash = `shared_tour=${code}`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GolfCalulator//Tour events//SV', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:golf-${code}-${event.id}-${group.id}@golfcalc`, `SEQUENCE:${Math.max(event.revision || 1, tour.status === 'cancelled' ? (tour.revision || 1) : 0)}`, `DTSTAMP:${utc(Math.max(event.updatedAt || event.createdAt || start, tour.status === 'cancelled' ? (tour.updatedAt || 0) : 0))}`,
      `DTSTART:${utc(start)}`, `DTEND:${utc(start + (course?.holes === 9 ? 150 : 300) * 60000)}`,
      `STATUS:${event.status === 'cancelled' || tour.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `SUMMARY:${escapeText(event.name + ' · ' + group.name)}`, `LOCATION:${escapeText(course?.name || '')}`,
      `DESCRIPTION:${escapeText(`${tour.name}\n${players.join(', ')}\nTidszon: ${event.timeZone}\n${event.note || ''}\nSluttiden är uppskattad.`)}`, `URL:${link.href}`, 'END:VEVENT', 'END:VCALENDAR'];
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  return Object.freeze({ validateEvent, teeTimeInstant, endOfDay, todayInZone, myStarts, calendar });
}));
