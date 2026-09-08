// Local-calendar-day boundaries for "today", shared by S1's bottom strip
// (Step 11) and the S4 Order Board (Step 15) so both ever agree on what
// counts as "due today" / "overdue" — extracted from dashboard/page.tsx's
// original getTodayRange() rather than kept as two copies that could
// silently drift apart. Deliberately real Date objects compared as a
// range, never a string comparison, so the boundary is exact regardless
// of what time of day the request happens to run.
export function getTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
