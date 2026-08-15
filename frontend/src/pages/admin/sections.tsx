import { Users, Mail, KeyRound, Database, MessageSquare, Hand } from 'lucide-react'
import type { AdminSection } from '../../lib/nav'

export interface AdminSectionMeta {
  id: AdminSection
  label: string
  sub: string
  icon: React.ReactNode
}

export const ADMIN_META: AdminSectionMeta[] = [
  { id: 'users', label: 'Users', sub: 'Accounts, roles and access', icon: <Users size={16} /> },
  { id: 'feedback', label: 'Feedback', sub: 'What users have reported', icon: <MessageSquare size={16} /> },
  { id: 'email', label: 'Email', sub: 'SMTP delivery for confirmation codes', icon: <Mail size={16} /> },
  { id: 'sso', label: 'Single sign-on', sub: 'OIDC provider and login button', icon: <KeyRound size={16} /> },
  { id: 'storage', label: 'Storage', sub: 'What is kept from imported files', icon: <Database size={16} /> },
  { id: 'social', label: 'Social', sub: 'How often members can ping each other', icon: <Hand size={16} /> },
]

export function adminMeta(id: string): AdminSectionMeta | undefined {
  return ADMIN_META.find(s => s.id === id)
}
