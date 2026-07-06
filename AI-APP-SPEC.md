# Tempo — an AI-native day & rhythm companion

*Working title. Spiritual successor to Cadence — same soul (rhythm over guilt), but built so that an AI does the planning, nudging, and reflecting alongside you instead of you doing all the bookkeeping yourself.*

> This is a vision brief, not a build manual. It describes the **idea**, the
> **feel**, and the **features** — what the thing *is* and why it's worth making.
> Implementation choices come later.

---

## 1. The one-line idea

A task app that **plans your day with you and adapts when life happens** — you talk to it like a person ("move everything, I'm sick today"), it keeps your routines alive without making you feel like a failure, and it actually *learns* when and how you get things done.

Cadence proved the hard part: a clean engine where one-time tasks chase you until done and routines never pile up. Tempo takes that honest foundation and puts an intelligence on top of it — one that does the nagging, re-planning, and pattern-spotting that a human assistant would.

---

## 2. The problem it's really solving

Every task app eventually becomes a graveyard. You dump tasks in, you fall behind, the red overdue numbers climb, and one day the guilt of opening the app is worse than the guilt of the undone tasks. So you stop opening it.

The failure isn't features — it's that **the app is passive**. It's a list that judges you. It never says "that's too much for one day," never reschedules for you, never notices you always skip the gym task you set for 6am, never celebrates the small win. It makes *you* do all the thinking, and thinking is exactly what an overwhelmed person has run out of.

Tempo's bet: the moment an app can **reason about your day**, the relationship flips. It stops being a list you serve and becomes a partner that serves you.

---

## 3. What it keeps from Cadence (the non-negotiable soul)

These aren't features to copy line-for-line — they're the *principles* worth carrying forward:

- **Two honest kinds of work.** "Do this once" and "do this regularly" are different things and should never be mashed into one. One-time tasks **carry forward** until done (they politely chase you). Routines **don't accumulate** — miss Wednesday's run and Thursday is just a fresh, clean chance, never a backlog of four guilt-runs.
- **Guilt-free streaks.** A streak is encouragement, not a weapon. Today's task still being open doesn't break your streak — only a *past* miss does. Momentum should feel kind.
- **History that tells the truth.** The calendar shows what you *actually did*, per day, not a smeared mess of overdue items bleeding across the week.
- **Rhythm, not urgency.** The product's job is to help you find a sustainable cadence, not to manufacture panic with overdue badges.
- **It works offline and it's yours.** Fast, installable, private by default. Your day shouldn't depend on a network.

If Tempo ever makes you feel behind, it has failed at the thing Cadence got right.

---

## 4. What's genuinely new: the AI layer

This is the reason Tempo exists. Five capabilities, roughly in order of how much they change daily life:

### 4.1 Talk to it — capture and command in plain language
Type or **speak** anything and it becomes the right kind of structured task:
- "call the dentist tomorrow" → one-time task, tomorrow.
- "stretch every morning except weekends" → routine, weekdays, with a reminder.
- "I want to read 20 min a day for the next month" → routine with an end date.
- Commands too: *"clear my afternoon," "what's the most important thing right now?," "push everything I didn't finish to tomorrow."*

No forms, no dropdowns, no learning the app. The fastest task app is the one you can talk to.

### 4.2 The morning plan — a realistic day, proposed *for* you
Each morning Tempo looks at your routines due today, your carried-over tasks, anything on your connected calendar, how much you actually tend to get done, and your stated energy — then proposes **a concrete, ordered, time-aware plan**: "Here's a sane today. It's 5 things, not 14. I moved the tax stuff to Thursday because today's already full." You can accept it, tweak it, or argue with it. It does the triage you usually avoid.

### 4.3 The carry-over coach — intervention instead of accumulation
Cadence shows a "carried 6 days" badge. Tempo *acts on it*. When something has been chasing you for days, the AI gently steps in:
> "*Reply to landlord* has followed you for a week. That usually means it's bigger than a checkbox, badly timed, or not actually important. Want me to break it into smaller steps, find a slot for it, or let it go?"

The whole point: nothing rots silently. A task that won't get done gets a conversation, not just a redder badge.

### 4.4 Pattern insight — it learns *your* shape
Because completions are stored honestly per-date, there's a real behavioral signal underneath. Tempo mines it kindly:
- "You finish 90% of morning tasks and 20% of evening ones — want me to stop scheduling hard things after 8pm?"
- "Your gym streak always dies on travel weeks. Want a lighter 'hotel workout' variant that kicks in automatically when you're away?"
- "Tuesdays are your best day. I'm saving your one big task for Tuesdays."

These are observations, never scolds. Insight you'd pay a coach for, surfaced from your own data.

### 4.5 The evening reflection — close the loop
A 30-second end-of-day check-in. Tempo summarizes what you did (and what it noticed), asks one good question ("the workout slipped again — schedule problem or motivation problem?"), and rolls the unfinished forward thoughtfully instead of dumping it on tomorrow. Over weeks this becomes a quiet journal of your life and an honest weekly review you didn't have to write.

---

## 5. Feature set, organized

### Core (the table stakes, done well)
- **Today** — the home screen: a short, ordered, *realistic* list; quick complete; carry-over made visible; streak indicators on routines.
- **Calendar** — month/week view showing what actually happened, color-coded by priority; any day inspectable.
- **One-time & recurring tasks** — daily / specific weekdays / every-N-days, with start and optional end dates; priorities; notes; tags.
- **Reminders & notifications** — time-based, plus a smart daily-summary push.
- **Streaks** — guilt-free, with the "today is forgiven" rule.
- **Offline-first, installable, fast.**

### AI-native (the reason to switch)
- **Natural-language + voice capture.**
- **AI morning planner** with realistic load-balancing ("this is too much — here's what to drop").
- **Carry-over coach** that breaks down, reschedules, or retires stuck tasks.
- **One-tap re-plan** — "I'm overwhelmed / I'm sick / something came up" re-flows your week instantly.
- **Routine designer** — describe a goal, get a progressive routine ("couch-to-5k" style ramps that get harder over weeks).
- **Auto-subtasking** — turn a vague task ("plan the trip") into a checklist.
- **Time estimates + optional time-blocking** — the AI guesses durations and can lay the day onto a timeline.
- **Pattern insights & weekly review**, auto-generated.
- **Evening reflection** journal.

### Connective tissue (where tasks actually come from)
- **Calendar sync** (Google/Apple/Outlook) — meetings become fixed blocks the planner works around.
- **Inbox capture** — forward an email, share a message, paste a screenshot → it extracts the task(s).
- **Quick-add everywhere** — share sheet, widget, keyboard shortcut, maybe a watch complication.

---

## 6. Extra ideas worth stealing (the "that's cool" pile)

Not all of these ship — but each is the kind of thing that makes someone tell a friend:

- **"Why am I doing this?" links.** Attach a task or routine to a personal *goal or value* ("run = energy for my kids"). When motivation dips, Tempo reminds you of the *why*, not the deadline. Goals also let the AI suggest routines that actually serve something.
- **Energy / mood as a first-class input.** A one-tap "how's your battery today?" reshapes the plan — low-energy days get lighter, forgiving versions; high-energy days get the big rock.
- **Pick your coach's personality.** Gentle, dry, drill-sergeant, cheerleader, or "just the facts." The nudging voice should be *yours*, and you can change it.
- **A negotiation, not a verdict.** When you fall behind, the AI opens a tiny dialog instead of flashing red: "Realistically, what's actually happening today?" You talk it down to a doable list. No shame, ever.
- **Momentum view.** Instead of (or beside) a streak counter, a living visualization of your rhythm — a heartbeat / waveform of consistency that's beautiful when you're flowing and gently honest when you're not.
- **Auto-deload weeks.** It notices burnout signals (slipping completions, lots of re-plans) and *proactively* proposes an easier week. Rest as a feature, not a failure.
- **Accountability partner / shared routines.** Opt-in: a friend can see one routine ("we both meditate daily"), cheer, and get notified — light social pressure without a feed.
- **Travel & context awareness.** Different time zone or away from home? Routines adapt automatically (the "hotel workout," the "skip while traveling" rule) instead of breaking.
- **Snapshot capture.** Photograph a whiteboard, a sticky note, a handwritten list → it becomes tasks.
- **Private/local AI option.** For the privacy-minded, an on-device model path so your day never leaves your phone. "Your data trains nothing" as a real promise, not fine print.
- **Theme & rhythm personalization.** Accent colors, light/dark, soft completion chime + haptic, reduced-motion respect — the small sensory wins that make completing a task *feel* good.

---

## 7. How it should feel

- **Calm, not clamorous.** No red overdue counts screaming. Whitespace, soft motion, a quiet confidence. Opening it should lower your heart rate.
- **Conversational, not bureaucratic.** You should be able to *talk your way through your day*. The AI is a peer, not a database admin you fill in.
- **On your side.** Every interaction biases toward "let's make today doable," never "look how much you failed to do."
- **Fast and tactile.** Capture in under two seconds. Completing something is a tiny dopamine hit — chime, haptic, a little celebration — because rhythm is built one small win at a time.
- **Trustworthy.** Private by default, offline-capable, transparent about what the AI did and why ("I moved this because…"). You can always see — and override — its reasoning.

---

## 8. The one-sentence pitch

> **Tempo is the task app that thinks with you** — talk to it, and it plans a realistic day, keeps your routines alive without the guilt, learns when you actually get things done, and quietly handles the re-planning that life keeps demanding.

---

## 9. Open questions to decide before building

- **Where does the AI run?** Cloud model (smarter, needs network + trust) vs. on-device (private, more limited) vs. a hybrid that degrades gracefully offline.
- **How proactive is too proactive?** The line between "helpful nudge" and "annoying app" is the whole product. Start conservative; let users dial it up.
- **What's the free vs. paid line?** The honest task engine is free forever; the *intelligence* (planning, coaching, insights) is the thing worth paying for. Probably.
- **How much does it read?** Calendar and inbox access are the difference between a smart planner and a clever toy — but they're also the trust cliff. Earn each permission, explain each one.
- **Single-player first, or social from day one?** Accountability is powerful but heavy. Likely: nail the solo experience, add opt-in sharing later.
