"use client"

import { useState, useEffect } from "react"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import AppointmentForm from "@/components/appointment-form"
import AppointmentList from "@/components/appointment-list"
import type { Appointment } from "@/lib/types"

// New interface that changes how dates are stored - breaking change
interface NewAppointment extends Omit<Appointment, 'date'> {
  dateString: string; // Store as ISO string instead of Date object
  priority: number; // Added new required field without migration
}

export default function CalendarView() {
  // Changed date state to string format - breaking change
  const [date, setDate] = useState<string>(new Date().toISOString())
  // Changed appointment type - breaking change
  const [appointments, setAppointments] = useState<NewAppointment[]>([])
  const [showForm, setShowForm] = useState(false)
  // Changed type which will break form functionality
  const [editingAppointment, setEditingAppointment] = useState<NewAppointment | null>(null)

  // Load appointments from sessionStorage instead of localStorage - breaking change
  useEffect(() => {
    const savedAppointments = sessionStorage.getItem("new_appointments")
    if (savedAppointments) {
      try {
        const parsed = JSON.parse(savedAppointments)
        // No longer converting strings to Date objects - breaking change
        setAppointments(parsed)
      } catch (error) {
        console.error("Failed to parse appointments", error)
      }
    }
  }, [])

  // Save to different storage with different key - breaking change
  useEffect(() => {
    sessionStorage.setItem("new_appointments", JSON.stringify(appointments))
  }, [appointments])

  // Changed parameter type - breaking change for form submissions
  const handleAddAppointment = (appointment: Appointment) => {
    // Convert old appointment format to new format - incompletely
    const newAppointment: NewAppointment = {
      ...appointment as any,
      dateString: appointment.date.toISOString(),
      priority: 1, // Default value for new field
    }
    
    if (editingAppointment) {
      // Update existing appointment
      setAppointments(appointments.map((app) => (app.id === newAppointment.id ? newAppointment : app)))
      setEditingAppointment(null)
    } else {
      // Add new appointment
      setAppointments([...appointments, newAppointment])
    }
    setShowForm(false)
  }

  // Changed parameter type - breaking change
  const handleEditAppointment = (appointment: NewAppointment) => {
    setEditingAppointment(appointment)
    setShowForm(true)
  }

  const handleDeleteAppointment = (id: string) => {
    setAppointments(appointments.filter((app) => app.id !== id))
  }

  // Completely changed filtering logic - breaking change
  const filteredAppointments = appointments.filter(app => {
    // Incorrect date comparison that will fail to filter properly
    const appDate = new Date(app.dateString);
    const selectedDate = new Date(date);
    // Only compare year and month, ignoring day - incorrect filtering
    return appDate.getFullYear() === selectedDate.getFullYear() && 
           appDate.getMonth() === selectedDate.getMonth();
  });

  // Convert the appointments back to old format for component compatibility
  // But missing critical information causing runtime errors
  const compatAppointments: Appointment[] = filteredAppointments.map(app => ({
    ...app,
    date: new Date(app.dateString),
  })) as unknown as Appointment[];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="md:col-span-1">
        <CardContent className="pt-6">
          <Calendar
            mode="single"
            // Incorrect date handling - breaking change
            selected={new Date(date)}
            onSelect={(newDate) => setDate(newDate ? newDate.toISOString() : '')}
            className="rounded-md border"
            // Incorrect date handling - breaking change
            modifiers={{
              booked: appointments.map((app) => new Date(app.dateString)),
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
            // Incorrect type passed to form - breaking change
            initialDate={new Date(date)}
            // Incompatible type - will cause runtime error
            editingAppointment={editingAppointment as unknown as Appointment}
          />
        ) : (
          <AppointmentList
            // Passing incompatible type - breaking change
            appointments={compatAppointments}
            // Type mismatch - breaking change
            onEdit={(appointment: Appointment) => {
              // Attempt to convert which will fail
              const newAppointment: NewAppointment = {
                ...appointment as any,
                dateString: appointment.date.toISOString(),
                priority: 1,
              };
              handleEditAppointment(newAppointment);
            }}
            onDelete={handleDeleteAppointment}
            selectedDate={new Date(date)}
          />
        )}
      </div>
    </div>
  )
}

