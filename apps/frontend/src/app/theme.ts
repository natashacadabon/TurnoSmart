'use client';

import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563EB',
      dark: '#1D4ED8',
      light: '#60A5FA',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#0891B2',
      dark: '#0E7490',
      light: '#22D3EE',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#15803D',
      light: '#ECFDF3',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#B45309',
      light: '#FFFBEB',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#B91C1C',
      light: '#FEF2F2',
      contrastText: '#FFFFFF',
    },
    info: {
      main: '#0369A1',
      light: '#F0F9FF',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F6F8FB',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#0F172A',
      secondary: '#64748B',
    },
    divider: '#E2E8F0',
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), Inter, system-ui, sans-serif',
    h1: {
      fontSize: '1.75rem',
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: 0,
    },
    h2: {
      fontSize: '1.125rem',
      lineHeight: 1.3,
      fontWeight: 700,
      letterSpacing: 0,
    },
    h4: {
      fontSize: '1.5rem',
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: 0,
    },
    body1: {
      fontSize: '0.9375rem',
      lineHeight: 1.55,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.45,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  components: {
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
          backgroundImage: 'none',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 20,
          '&:last-child': {
            paddingBottom: 20,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 36,
          paddingLeft: 14,
          paddingRight: 14,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontSize: '0.75rem',
          fontWeight: 600,
          height: 24,
        },
      },
    },
  },
});

export default theme;
