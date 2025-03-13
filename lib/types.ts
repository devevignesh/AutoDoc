export interface Appointment {
  id: string
  title: string
  description?: string
  date: Date
  duration: number
  location?: string
  timezone?: string
}

