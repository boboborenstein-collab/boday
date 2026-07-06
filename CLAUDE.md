# BoDay - PWA Task/Routine Manager

## Project Overview
BoDay is a React + TypeScript + Vite PWA for managing daily tasks and recurring routines with calendar visualization and priority management.

## Running the App

### Start Development Server
```bash
npm run dev
```
The app will be available at **http://localhost:5173**

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Features
- **Calendar View**: Month-at-a-glance with color-coded task indicators
- **Daily View**: Today's tasks with summary metrics (To do, Carried over, P1, Done)
- **Task Management**: Create/edit one-time or recurring tasks
- **Priority Levels**: P1 (Urgent/Red), P2 (High/Orange), P3 (Medium/Blue), P4 (Low/Purple)
- **Smart Recurring**: Tasks reset daily without piling up
- **Carry-Over Tracking**: Shows how many days tasks have been delayed
- **PWA**: Works offline with local storage

## Tech Stack
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Zustand (state management)
- React Router v7
- date-fns (date utilities)

## Running Demo
To launch and demo the app in the browser:
```bash
/run
```
This will start the dev server and open it in browser automation.
