import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, put } from '@/lib/api'
import { useCertificates, usePilotInfo } from './api'
import type { PilotCerts } from './pilot'
import { parseRouteItem, type AircraftPlanning, type AirportProfile, type Plan } from './model'

// Profiles (docs/planner-ux.md, "Profiles"): the people, aircraft and airports
// a plan loads. Each is created, read, changed and deleted on its own (the
// Profiles view) or from inside a plan; a plan keeps a copy of what it loaded
// (seat weights, the instructor's name), so changing a profile later doesn't
// rewrite a flight already planned.
//
//   You         planner_settings 'pilot' (name, weight, contact, base) plus
//               'certificates' and 'minimums': the Part 61 checks, your
//               minimums, the pilot seat and the flight-plan form.
//   People      planner_settings 'people': instructors and passengers with
//               their weight, for the seats and the dual role.
//   Aircraft    planner_aircraft per tail: empty weight and moment, tanks,
//               inspections, equipment and your values over the POH's.
//   Airports    planner_airport_profiles per ident: pattern altitude, pattern
//               side per runway, notes for the NavLog.

export type Seat = 'pilot' | 'front' | 'rearL' | 'rearR'
export const SEATS: { key: Seat; label: string }[] = [{ key: 'pilot', label: 'Pilot' }, { key: 'front', label: 'Front right' }, { key: 'rearL', label: 'Rear left' }, { key: 'rearR', label: 'Rear right' }]
export const SELF = 'self'

// pilot: flies the airplane (student, private and up), with the certificate,
// medical and endorsements the Part 61 checks read; instructor: a CFI for dual;
// passenger: a weight in a seat.
export type PersonRole = 'pilot' | 'instructor' | 'passenger'
export interface Person { id: string; name: string; role: PersonRole; weightLb: number | null; phone?: string; notes?: string; cfi?: string; address?: string; base?: string; certs?: PilotCerts }
export interface SelfInfo { name?: string; phone?: string; address?: string; base?: string; weightLb?: number | null; updatedAt?: string }

const MIN = 60_000
export const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function usePeople() {
  const qc = useQueryClient()
  const key = ['planner', 'settings', 'people']
  const q = useQuery({ queryKey: key, staleTime: Infinity, queryFn: () => get<{ list?: Person[]; updatedAt?: string }>('/api/planner/settings/people') })
  const save = useMutation({ mutationFn: (list: Person[]) => put<{ list: Person[] }>('/api/planner/settings/people', { list }), onSuccess: d => qc.setQueryData(key, d) })
  const list = q.data?.list ?? []
  return {
    ...q, list, save,
    upsert: (p: Person) => save.mutateAsync(list.some(x => x.id === p.id) ? list.map(x => (x.id === p.id ? p : x)) : [...list, p]),
    remove: (id: string) => save.mutateAsync(list.filter(x => x.id !== id)),
  }
}

export interface SavedAircraft extends AircraftPlanning { tail: string }
export function useAircraftProfiles() {
  const qc = useQueryClient()
  const key = ['planner', 'aircraft-profiles']
  const q = useQuery({ queryKey: key, staleTime: 5 * MIN, queryFn: () => get<SavedAircraft[]>('/api/planner/aircraft') })
  const save = useMutation({
    mutationFn: ({ tail, data }: { tail: string; data: AircraftPlanning }) => put<AircraftPlanning>(`/api/planner/aircraft/${tail}`, data),
    onSuccess: (d, v) => { qc.setQueryData(['planner', 'aircraft', v.tail], d); qc.invalidateQueries({ queryKey: key }) },
  })
  const remove = useMutation({
    mutationFn: (tail: string) => del(`/api/planner/aircraft/${tail}`),
    onSuccess: (_, tail) => { qc.setQueryData(['planner', 'aircraft', tail], {}); qc.invalidateQueries({ queryKey: key }) },
  })
  return { ...q, save, remove }
}

export function useAllAirportProfiles() {
  const qc = useQueryClient()
  const key = ['planner', 'airport-profiles', 'all']
  const q = useQuery({ queryKey: key, staleTime: 5 * MIN, queryFn: () => get<Record<string, AirportProfile>>('/api/planner/airport-profiles?all=1') })
  const save = useMutation({
    mutationFn: ({ id, profile }: { id: string; profile: AirportProfile | null }) => (profile ? put<AirportProfile>(`/api/planner/airport-profiles/${id}`, profile) : del(`/api/planner/airport-profiles/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planner', 'airport-profiles'] }),
  })
  return { ...q, save }
}

// Putting someone in a seat: their weight (if their profile has one) and who
// it is. A weight typed afterwards stays this flight's; the person stays named.
export function seatPerson(plan: Pick<Plan, 'seats' | 'seatPeople' | 'crew'>, seat: Seat, who: { id: string; weightLb: number | null; name?: string; role?: PersonRole } | null): Partial<Plan> {
  const seats = plan.seats ?? { pilot: 0, front: 0, rearL: 0, rearR: 0 }
  const people = { ...plan.seatPeople }
  if (!who) { delete people[seat]; return { seatPeople: people } }
  // One seat per person: moving someone empties the seat they were in.
  const out: Partial<Plan> = {}
  const nextSeats = { ...seats }
  for (const k of Object.keys(people) as Seat[]) if (k !== seat && people[k] === who.id) { delete people[k]; nextSeats[k] = 0 }
  people[seat] = who.id
  if (who.weightLb != null && who.weightLb > 0) nextSeats[seat] = who.weightLb
  out.seats = nextSeats
  out.seatPeople = people
  // An instructor in the right seat is the CFI of a dual flight.
  if (seat === 'front' && who.role === 'instructor') out.crew = { ...plan.crew, role: 'dual', instructor: who.name }
  return out
}

// Everyone who can be loaded into a flight. Your own details (settings 'pilot'
// and 'certificates', saved before pilots were profiles) are the pilot "self";
// everyone else is in 'people'. Saving routes each to where it's kept.
export function useCrew() {
  const info = usePilotInfo(), certs = useCertificates(), people = usePeople()
  const i = info.data, c = certs.data
  const self: Person | null = i?.name || i?.weightLb || c?.certificate
    ? { id: SELF, name: i?.name || 'You', role: 'pilot', weightLb: i?.weightLb ?? null, phone: i?.phone, address: i?.address, base: i?.base, certs: c?.certificate ? c : undefined }
    : null
  const list = [...(self ? [self] : []), ...people.list]
  const save = async (p: Person) => {
    if (p.id !== SELF) return people.upsert(p)
    await info.save.mutateAsync({ ...i, name: p.name, weightLb: p.weightLb, phone: p.phone, address: p.address, base: p.base })
    if (p.certs) await certs.save.mutateAsync(p.certs)
  }
  return {
    list, pilots: list.filter(p => p.role === 'pilot'), instructors: list.filter(p => p.role === 'instructor'), passengers: list.filter(p => p.role === 'passenger'),
    save, remove: (id: string) => (id === SELF ? Promise.resolve() : people.remove(id)),
    isLoading: info.isLoading || certs.isLoading || people.isLoading, saving: info.save.isPending || certs.save.isPending || people.save.isPending,
  }
}

// How many saved flights load a profile, so deleting it can say what's affected.
export function usedBy(plans: { data: Plan }[] | undefined, kind: 'pilots' | 'aircraft' | 'airports', key: string) {
  return (plans ?? []).filter(({ data: p }) => kind === 'aircraft' ? p.tail === key
    : kind === 'airports' ? p.route.some(r => parseRouteItem(r).id === key) || p.alternate === key
      : Object.values(p.seatPeople ?? {}).includes(key) || p.crew?.pilotId === key || p.crew?.instructorId === key).length
}
