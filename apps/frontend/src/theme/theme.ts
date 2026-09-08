'use client';

import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: true,

  palette: {
    mode: 'light',

    primary: {
      main: '#2563EB',
      light: '#60A5FA',
      dark: '#1D4ED8',
      contrastText: '#FFFFFF',
    },

    secondary: {
      main: '#0891B2',
      light: '#22D3EE',
      dark: '#0E7490',
      contrastText: '#FFFFFF',
    },

    success: {
      main: '#15803D',
      light: '#ECFDF3',
      dark: '#15803D',
      contrastText: '#FFFFFF',
    },

    warning: {
      main: '#B45309',
      light: '#FFFBEB',
      dark: '#92400E',
      contrastText: '#FFFFFF',
    },

    error: {
      main: '#B91C1C',
      light: '#FEF2F2',
      dark: '#B91C1C',
      contrastText: '#FFFFFF',
    },

    info: {
      main: '#0369A1',
      light: '#F0F9FF',
      dark: '#075985',
      contrastText: '#FFFFFF',
    },

    background: {
      default: '#F6F8FB',
      paper: '#FFFFFF',
    },

    text: {
      primary: '#0F172A',
      secondary: '#64748B',
      disabled: '#94A3B8',
    },

    divider: '#E2E8F0',

    action: {
      hover: '#F1F5F9',
      selected: '#E0F2FE',
      disabled: '#CBD5E1',
      disabledBackground: '#F1F5F9',
    },
  },

  shape: {
    borderRadius: 8,
  },

  typography: {
    fontFamily: 'var(--font-inter)',

    h1: {
      fontWeight: 700,
      color: '#0F172A',
      letterSpacing: '-0.03em',
    },

    h2: {
      fontWeight: 700,
      color: '#0F172A',
      letterSpacing: '-0.02em',
    },

    h3: {
      fontWeight: 600,
      color: '#0F172A',
    },

    h4: {
      fontWeight: 600,
      color: '#0F172A',
    },

    body1: {
      color: '#0F172A',
    },

    body2: {
      color: '#64748B',
    },

    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F6F8FB',
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
          paddingLeft: 16,
          paddingRight: 16,
          minHeight: 40,

          '&.MuiButton-containedPrimary:hover': {
            backgroundColor: '#1D4ED8',
          },

          '&.MuiButton-outlinedPrimary': {
            borderColor: '#CBD5E1',
          },

          '&.MuiButton-outlinedPrimary:hover': {
            borderColor: '#2563EB',
            backgroundColor: '#EFF6FF',
          },
        },
      },
    },

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

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },

        rounded: {
          borderRadius: 12,
        },
      },
    },

    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,

          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#CBD5E1',
          },

          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#94A3B8',
          },

          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#2563EB',
            borderWidth: 2,
          },
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#64748B',

          '&.Mui-focused': {
            color: '#2563EB',
          },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
        },
      },
    },

    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#F8FAFC',
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: '#E2E8F0',
        },

        head: {
          color: '#475569',
          fontWeight: 600,
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#E2E8F0',
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#0F172A',
          fontSize: '0.75rem',
          borderRadius: 6,
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          border: '1px solid #E2E8F0',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)',
        },
      },
    },
  },
});

export default theme;
