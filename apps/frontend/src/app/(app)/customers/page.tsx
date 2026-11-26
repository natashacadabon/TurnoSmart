'use client';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import PhoneRoundedIcon from '@mui/icons-material/PhoneRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { can, type CustomerDto, type Paginated } from '@turnosmart/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { CustomerFormDialog } from '@/components/CustomerFormDialog';
import { DeleteCustomerDialog } from '@/components/DeleteCustomerDialog';
import { EmptyState, NameAvatar, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

const PAGE_SIZE = 20;

function Contact({ icon, value }: { icon: React.ReactNode; value: string | null }) {
  if (!value) return <Typography color="text.disabled">—</Typography>;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', color: 'text.secondary', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', '& svg': { fontSize: 16 } }}>{icon}</Box>
      <Typography variant="body2" noWrap sx={{ color: 'text.primary' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function CustomersPage() {
  const { me } = useAuth();
  const canDelete = me?.onboarded ? can(me.profile.role, 'customers:delete') : false;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Paginated<CustomerDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; customer: CustomerDto | null }>({
    open: false,
    customer: null,
  });
  const [toDelete, setToDelete] = useState<CustomerDto | null>(null);

  // Búsqueda con debounce para no disparar un request por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
    if (query) params.set('search', query);
    api<Paginated<CustomerDto>>(`/api/customers?${params}`).then(
      (result) => {
        if (!active) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [page, query, reloadKey]);

  /** Vuelve a pedir la página actual (reintento o después de guardar). */
  const reload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const openNew = () => setDialog({ open: true, customer: null });

  /** Tras una baja: si era el último de la página, vuelve a la anterior. */
  const afterDelete = () => {
    setToDelete(null);
    if (page > 0 && data?.items.length === 1) {
      setLoading(true);
      setPage(page - 1);
    } else {
      reload();
    }
  };
  const isEmpty = !loading && data?.items.length === 0;
  const subtitle = data
    ? query
      ? `${data.total} ${data.total === 1 ? 'resultado' : 'resultados'} para "${query}"`
      : `${data.total} ${data.total === 1 ? 'cliente registrado' : 'clientes registrados'}`
    : 'Personas que reservan turnos en tu negocio';

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={subtitle}
        actions={
          <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={openNew}>
            Nuevo cliente
          </Button>
        }
      />

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button onClick={reload}>Reintentar</Button>}
        >
          {error}
        </Alert>
      )}

      <Card>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Buscar por nombre, email o teléfono"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ maxWidth: { sm: 360 } }}
            slotProps={{
              htmlInput: { 'aria-label': 'Buscar clientes' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {isEmpty ? (
          query ? (
            <EmptyState
              icon={<SearchOffRoundedIcon />}
              title="Sin resultados"
              description={`No encontramos clientes que coincidan con "${query}".`}
              action={<Button onClick={() => setSearch('')}>Limpiar búsqueda</Button>}
            />
          ) : (
            <EmptyState
              icon={<PeopleAltRoundedIcon />}
              title="Todavía no cargaste clientes"
              description="Agregá a las personas que reservan turnos para poder agendarlas."
              action={
                <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={openNew}>
                  Agregar el primero
                </Button>
              }
            />
          )
        ) : (
          <>
            <TableContainer>
              <Table aria-label="Listado de clientes" sx={{ tableLayout: 'fixed' }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: { xs: '70%', md: '38%' } }}>Cliente</TableCell>
                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Email</TableCell>
                    <TableCell
                      sx={{
                        display: { xs: 'none', sm: 'table-cell' },
                        width: { sm: '30%', md: '22%' },
                      }}
                    >
                      Teléfono
                    </TableCell>
                    <TableCell align="right" sx={{ width: canDelete ? 104 : 64 }}>
                      <Box
                        component="span"
                        sx={{
                          // Solo para lectores de pantalla. En sx, width: 1 sería 100%: usar px.
                          position: 'absolute',
                          width: '1px',
                          height: '1px',
                          margin: '-1px',
                          padding: 0,
                          border: 0,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          clip: 'rect(0 0 0 0)',
                        }}
                      >
                        Acciones
                      </Box>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && !data
                    ? Array.from({ length: 5 }, (_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                              <Skeleton variant="circular" width={36} height={36} />
                              <Skeleton width="60%" />
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            <Skeleton width="70%" />
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Skeleton width="60%" />
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))
                    : data?.items.map((c) => (
                        <TableRow key={c.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                          <TableCell>
                            <Stack
                              direction="row"
                              spacing={1.5}
                              sx={{ alignItems: 'center', minWidth: 0 }}
                            >
                              <NameAvatar name={c.fullName} />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 600 }} noWrap>
                                  {c.fullName}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" noWrap>
                                  {c.notes || (
                                    <Box component="span" sx={{ display: { md: 'none' } }}>
                                      {c.email ?? c.phone ?? ''}
                                    </Box>
                                  )}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            <Contact icon={<MailOutlineRoundedIcon />} value={c.email} />
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                            <Contact icon={<PhoneRoundedIcon />} value={c.phone} />
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Editar">
                              <IconButton
                                aria-label={`Editar ${c.fullName}`}
                                onClick={() => setDialog({ open: true, customer: c })}
                              >
                                <EditRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {canDelete && (
                              <Tooltip title="Eliminar">
                                <IconButton
                                  aria-label={`Eliminar ${c.fullName}`}
                                  onClick={() => setToDelete(c)}
                                  sx={{ '&:hover': { color: '#b91c1c', bgcolor: '#fef2f2' } }}
                                >
                                  <DeleteOutlineRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </TableContainer>
            {(data?.total ?? 0) > PAGE_SIZE && (
              <TablePagination
                component="div"
                count={data?.total ?? 0}
                page={page}
                rowsPerPage={PAGE_SIZE}
                rowsPerPageOptions={[PAGE_SIZE]}
                onPageChange={(_, p) => setPage(p)}
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                sx={{ borderTop: 1, borderColor: 'divider' }}
              />
            )}
          </>
        )}
      </Card>

      {dialog.open && (
        <CustomerFormDialog
          open={dialog.open}
          customer={dialog.customer}
          onClose={() => setDialog({ open: false, customer: null })}
          onSaved={() => {
            setDialog({ open: false, customer: null });
            reload();
          }}
        />
      )}

      {toDelete && (
        <DeleteCustomerDialog
          customer={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={afterDelete}
        />
      )}
    </>
  );
}
