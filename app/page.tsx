import type { Metadata } from "next"
import CalendarView from "@/components/calendar-view"

export const metadata: Metadata = {
  title: "Scheduling App",
  description: "Manage your appointments with ease",
}

export default function HomePage() {
  return (
    <div className="container py-10">
      <h1 className="text-4xl font-bold mb-8 text-center">Scheduling App Test 1</h1>
      <CalendarView />
    </div>
  )
}

