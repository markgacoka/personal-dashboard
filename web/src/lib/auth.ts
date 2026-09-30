import { post } from './api'

export async function signOut() {
  await post('/api/auth/sign-out').catch(() => {})
  location.replace('/login')
}
