import type { AuthState } from './auth-state';

export function authRedirectTarget(
	status: AuthState['status'],
	pathname: string,
	isConfigured: boolean
): string | null {
	if (!isConfigured || status === 'loading' || status === 'local') return null;
	if ((status === 'signed-out' || status === 'error') && pathname !== '/login') return '/login';
	if (status === 'signed-in' && pathname === '/login') return '/';
	if (status === 'recovery' && pathname !== '/account') return '/account';
	return null;
}
