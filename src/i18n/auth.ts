/** Isolated additive auth namespace. English is the explicit fallback in increment 1.
 * Shared dictionaries stay untouched for the concurrent capture/localization work.
 * Translate this namespace before presenting real-account auth in another language. */
export const authCopy = {
    brand: 'FixList', realTitle: 'FixList · Account setup', demoTitle: 'FixList · Local demo', loading: 'Loading FixList…', checking: 'Checking your account…', preview: 'Real account · Account setup preview',
    demoMode: 'Local demo mode', demoNotice: ' · Fictional accounts and activity on this device. ', realSignIn: 'Real account sign-in',
    title: 'Sign in to FixList', intro: 'Use a real account, or explore the separate local demos below.',
    emailLogin: 'Email sign-in', email: 'Email', password: 'Password', login: 'Sign in with email',
    create: 'Create account', createTitle: 'Create an account', resetTitle: 'Reset your password', forgot: 'Forgot password?', sendReset: 'Send reset email',
    resend: 'Resend confirmation email', google: 'Continue with Google', apple: 'Continue with Apple', unavailable: ' · unavailable',
    missingBackend: 'Real sign-in is unavailable until the new FixList backend is configured.',
    missingNative: 'Real sign-in is unavailable in this iPhone build. Secure account support needs to be enabled for this build.',
    recoveryTitle: 'Choose a new password', newPassword: 'New password', savePassword: 'Save password',
    profileError: 'Account setup is unavailable', profileErrorBody: 'We verified your sign-in, but could not load your private profile. No demo data has been loaded.', retry: 'Retry profile',
    setupIntro: 'Your new account starts empty. Choose how you will use FixList.', setupTitle: 'Set up your account',
    elder: 'I need help at home', volunteer: 'I want to volunteer', noFamily: 'Family access is not available yet.',
    saved: 'Your private profile is saved to your account.', welcome: 'Welcome', role: 'Role', elderRole: 'Elder', volunteerRole: 'Volunteer', featuresLabel: 'Account features',
    noCommunityTitle: 'Community features are not available yet',
    noCommunity: 'This account has no shared jobs, messages, credited hours, family links or screening badges. Posting, matching and volunteering will open after their server permissions and commands are implemented.',
    noCapture: 'Room capture is unavailable in real account mode in this increment. Existing local demo captures stay in demo mode and are never imported or uploaded.',
    wait: 'Please wait…', cancel: 'Cancel pending sign-in', signOut: 'Sign out', explore: 'Explore local demos',
    demoExplanation: 'Demos include filled examples and new blank elder and volunteer profiles. They do not create real accounts.',
    languageLimit: 'Account sign-in screens are currently in English. You can choose your profile language during setup.',
    messages: {
        confirmation: 'Check your email to confirm your account. Open the newest link on this same device and browser. If you already confirmed elsewhere, try signing in.',
        'reset-sent': 'If that address has an account, a password reset email has been requested. Open the newest link on this same device and browser.',
        'auth-error': 'The request could not be completed. Check your connection and details, or request a new link on this device. Your account has not switched to a demo.',
        cancelled: 'Sign-in cancelled. Start again when you are ready.',
        'password-updated': 'Password updated.',
    },
} as const;
