import { describe, expect, it } from 'vitest';
import { authRedirectTarget } from './auth-routing';

describe('authRedirectTarget', () => {
	it('未ログインの利用者をログイン画面へ案内する', () => {
		expect(authRedirectTarget('signed-out', '/', true)).toBe('/login');
		expect(authRedirectTarget('signed-out', '/tasks', true)).toBe('/login');
		expect(authRedirectTarget('signed-out', '/login', true)).toBeNull();
	});

	it('ログイン済みの利用者をログイン画面からホームへ戻す', () => {
		expect(authRedirectTarget('signed-in', '/login', true)).toBe('/');
		expect(authRedirectTarget('signed-in', '/account', true)).toBeNull();
	});

	it('パスワード再設定中はアカウント画面へ案内する', () => {
		expect(authRedirectTarget('recovery', '/login', true)).toBe('/account');
		expect(authRedirectTarget('recovery', '/account', true)).toBeNull();
	});

	it('認証未設定のローカル体験版は移動させない', () => {
		expect(authRedirectTarget('local', '/', false)).toBeNull();
		expect(authRedirectTarget('signed-out', '/', false)).toBeNull();
	});
});
