"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Appointment } from "@/lib/types"
import { Clock, MapPin, Edit, Trash2, Globe } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useState } from "react"

interface AppointmentListProps {
  appointments: Appointment[]
  onEdit: (appointment: Appointment) => void
  onDelete: (id: string) => void
  selectedDate?: Date
}

export default function AppointmentList({ appointments, onEdit, onDelete, selectedDate }: AppointmentListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Format time from Date object
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{selectedDate ? `Appointments for ${formatDate(selectedDate)}` : "All Appointments"}</CardTitle>
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No appointments scheduled for this day.</div>
        ) : (
          <div className="space-y-4">
            {appointments
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .map((appointment) => (
                <Card key={appointment.id} className="overflow-hidden">
                  <div className="p-4 border-l-4 border-primary">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-lg">{appointment.title}</h3>

                        <div className="flex items-center text-muted-foreground mt-2">
                          <Clock className="h-4 w-4 mr-1" />
                          <span className="text-sm">
                            {formatTime(appointment.date)} ({appointment.duration} min)
                          </span>
                        </div>

                        {appointment.timezone && (
                          <div className="flex items-center text-muted-foreground mt-1">
                            <Globe className="h-4 w-4 mr-1" />
                            <span className="text-sm">{appointment.timezone}</span>
                          </div>
                        )}

                        {appointment.location && (
                          <div className="flex items-center text-muted-foreground mt-1">
                            <MapPin className="h-4 w-4 mr-1" />
                            <span className="text-sm">{appointment.location}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(appointment)}>
                          <Edit className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                        </Button>

                        <AlertDialog
                          open={deleteId === appointment.id}
                          onOpenChange={(open) => {
                            if (!open) setDeleteId(null)
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteId(appointment.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Appointment</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this appointment? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  if (deleteId) onDelete(deleteId)
                                  setDeleteId(null)
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    {appointment.description && <div className="mt-3 text-sm">{appointment.description}</div>}
                  </div>
                </Card>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

