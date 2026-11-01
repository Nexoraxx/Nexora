import { VARIABLES } from '../constants/template.constant'

export type Variable = (typeof VARIABLES)[number]

export type Person = { displayName: string | null; zaloName: string | null; alias: string | null; gender: number | null; phoneNumber: string | null }
