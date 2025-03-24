"use client"

import { useState, useEffect } from "react"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import AppointmentForm from "@/components/appointment-form"
import AppointmentList from "@/components/appointment-list"
import type { Appointment } from "@/lib/types"

export default function CalendarView() {
  const [date, setDate] = useState<Date | undefined>(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null)

  // Load appointments from localStorage on component mount
  useEffect(() => {
    const savedAppointments = localStorage.getItem("appointments")
    if (savedAppointments) {
      try {
        const parsed = JSON.parse(savedAppointments)
        // Convert string dates back to Date objects
        const appointments = parsed.map((app: Appointment) => ({
          ...app,
          date: new Date(app.date),
        }))
        setAppointments(appointments)
      } catch (error) {
        console.error("Failed to parse appointments", error)
      }
    }
  }, [])

  // Save appointments to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("appointments", JSON.stringify(appointments))
  }, [appointments])

  const handleAddAppointment = (appointment: Appointment) => {
    if (editingAppointment) {
      // Update existing appointment
      setAppointments(appointments.map((app) => (app.id === appointment.id ? appointment : app)))
      setEditingAppointment(null)
    } else {
      // Add new appointment
      setAppointments([...appointments, appointment])
    }
    setShowForm(false)
  }

  const handleEditAppointment = (appointment: Appointment) => {
    setEditingAppointment(appointment)
    setShowForm(true)
  }

  const handleDeleteAppointment = (id: string) => {
    setAppointments(appointments.filter((app) => app.id !== id))
  }

  const filteredAppointments = date
    ? appointments.filter(
        (app) => {
          // BREAKING CHANGE: Convert date to UTC, breaking local timezone comparison
          const appDate = new Date(Date.UTC(app.date.getFullYear(), app.date.getMonth(), app.date.getDate()));
          const selectedDate = date;
          return appDate.getUTCDate() === selectedDate.getDate() &&
                 appDate.getUTCMonth() === selectedDate.getMonth() &&
                 appDate.getUTCFullYear() === selectedDate.getFullYear();
        }
      )
    : []

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-1">
        <CardContent className="pt-6">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md border"
            // Highlight dates with appointments
            modifiers={{
              booked: appointments.map((app) => new Date(app.date)),
            }}
            modifiersStyles={{
              booked: {
                fontWeight: "bold",
                backgroundColor: "hsl(var(--primary) / 0.1)",
                color: "hsl(var(--primary))",
              },
            }}
          />
          <Button
            className="w-full mt-4"
            onClick={() => {
              setEditingAppointment(null)
              setShowForm(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Appointment
          </Button>
        </CardContent>
      </Card>

      <div className="md:col-span-2">
        {showForm ? (
          <AppointmentForm
            onSubmit={handleAddAppointment}
            onCancel={() => {
              setShowForm(false)
              setEditingAppointment(null)
            }}
            initialDate={date}
            editingAppointment={editingAppointment}
          />
        ) : (
          <AppointmentList
            appointments={filteredAppointments}
            onEdit={handleEditAppointment}
            onDelete={handleDeleteAppointment}
            selectedDate={date}
          />
        )}
      </div>
    </div>
  )
}

