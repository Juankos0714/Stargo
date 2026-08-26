// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Sesión resuelta por handleSession en hooks.server.ts (null si anónimo). */
			session: import('$lib/server/auth').SesionInfo | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
