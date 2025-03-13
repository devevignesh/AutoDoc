"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { Appointment } from "@/lib/types"
import { TimezoneSelector } from "@/components/timezone-selector"
import { v4 as uuidv4 } from "uuid"

interface AppointmentFormProps {
  onSubmit: (appointment: Appointment) => void
  onCancel: () => void
  initialDate?: Date
  editingAppointment: Appointment | null
}

export default function AppointmentForm({
  onSubmit,
  onCancel,
  initialDate = new Date(),
  editingAppointment,
}: AppointmentFormProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState<Date>(initialDate || new Date())
  const [time, setTime] = useState("09:00")
  const [duration, setDuration] = useState("60")
  const [location, setLocation] = useState("")
  const [timezone, setTimezone] = useState("UTC")

  // If editing an appointment, populate the form
  useEffect(() => {
    if (editingAppointment) {
      setTitle(editingAppointment.title)
      setDescription(editingAppointment.description || "")
      setDate(new Date(editingAppointment.date))

      // Format time from Date object
      const hours = editingAppointment.date.getHours().toString().padStart(2, "0")
      const minutes = editingAppointment.date.getMinutes().toString().padStart(2, "0")
      setTime(`${hours}:${minutes}`)

      setDuration(editingAppointment.duration.toString())
      setLocation(editingAppointment.location || "")
      setTimezone(editingAppointment.timezone || "UTC")
    }
  }, [editingAppointment])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Create a date object with the selected date and time
    const [hours, minutes] = time.split(":").map(Number)
    const appointmentDate = new Date(date)
    appointmentDate.setHours(hours, minutes, 0, 0)

    const appointment: Appointment = {
      id: editingAppointment?.id || uuidv4(),
      title,
      description,
      date: appointmentDate,
      duration: Number.parseInt(duration),
      location,
      timezone,
    }

    onSubmit(appointment)
  }

  // Format date for input
  const formatDateForInput = (date: Date) => {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, "0")
    const day = date.getDate().toString().padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editingAppointment ? "Edit Appointment" : "New Appointment"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Appointment title"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formatDateForInput(date)}
                onChange={(e) => setDate(new Date(e.target.value))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min="5"
                step="5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Meeting location (optional)"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <TimezoneSelector value={timezone} onChange={setTimezone} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details about this appointment"
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{editingAppointment ? "Update" : "Create"} Appointment</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

