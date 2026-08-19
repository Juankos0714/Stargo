import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.stargo.app',
	appName: 'StarGo',
	webDir: 'build',
	server: {
		androidScheme: 'https'
	},
	plugins: {
		PushNotifications: {
		PresentationOptions: ['badge', 'sound', 'alert']
		}
	}
};

export default config;
