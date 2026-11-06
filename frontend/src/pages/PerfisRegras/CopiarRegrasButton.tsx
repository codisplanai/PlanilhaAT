import React, { useState } from 'react';
import { Copy } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getErrorMessage } from '../../api/client';
import { perfisApi } from '../../api/perfis';
import { queryKeys } from '../../api/queryKeys';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { readStoredUser } from '../../lib/sessionStorage';
import type { CopiarRegrasResultado, CopiarRegrasSecao } from '../../types/perfil';

const REGRAS_QUERY_PREFIXES = [
  'regras-aliquotas',
  'regras-cfop-efetivas',
  'regras-reducao-produto',
  'regras-reclassificacao-cfop',
  'regras-exclusao-parcial',
];

interface CopiarRegrasButtonProps {
  perfilId: number;
  secao: CopiarRegrasSecao;
  /** Omitido = seção inteira do perfil. */
  regraIds?: number[];
  /** Texto do botão. Sem ele, renderiza só o ícone (uso em linha de regra). */
  label?: string;
  /** Descrição do que será copiado, exibida no modal. */
  descricao: string;
}

/** Copia regras para outros perfis. Só administradores veem o botão. */
export const CopiarRegrasButton: React.FC<CopiarRegrasButtonProps> = ({
  perfilId,
  secao,
  regraIds,
  label,
  descricao,
}) => {
  const isAdmin = readStoredUser()?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [todos, setTodos] = useState(true);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [resultado, setResultado] = useState<CopiarRegrasResultado | null>(null);
  const queryClient = useQueryClient();

  const perfisQuery = useQuery({
    queryKey: queryKeys.perfis,
    queryFn: perfisApi.listar,
    enabled: isAdmin && open,
  });
  const outrosPerfis = (perfisQuery.data ?? []).filter((perfil) => perfil.id !== perfilId);

  const copiar = useMutation({
    mutationFn: () =>
      perfisApi.copiarRegras(perfilId, {
        secao,
        ...(regraIds ? { regra_ids: regraIds } : {}),
        ...(todos ? { todos_os_demais: true } : { perfil_destino_ids: selecionados }),
      }),
    onSuccess: (data) => {
      setResultado(data);
      void queryClient.invalidateQueries({
        predicate: (query) => REGRAS_QUERY_PREFIXES.includes(String(query.queryKey[0])),
      });
    },
  });

  if (!isAdmin || (regraIds && regraIds.length === 0)) return null;

  const abrir = () => {
    setTodos(true);
    setSelecionados([]);
    setResultado(null);
    copiar.reset();
    setOpen(true);
  };
  const alternar = (id: number) =>
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id],
    );
  const podeCopiar = todos ? outrosPerfis.length > 0 : selecionados.length > 0;

  return (
    <>
      {label ? (
        <Button size="sm" variant="outline" onClick={abrir} leftIcon={<Copy className="h-3.5 w-3.5" />}>
          {label}
        </Button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700"
          title="Copiar para outros perfis"
          aria-label="Copiar para outros perfis"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Copiar para outros perfis"
        subtitle={`Origem: ${perfisQuery.data?.find((perfil) => perfil.id === perfilId)?.nome ?? ''}`}
        maxWidth="md"
      >
        {resultado ? (
          <div className="space-y-4">
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {resultado.resultados.map((item) => (
                <li key={item.perfil_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate font-medium text-slate-900">{item.perfil_nome}</span>
                  <span className="shrink-0 text-xs text-slate-600">
                    <strong className="text-emerald-700">{item.copiadas}</strong> copiada(s)
                    {item.ignoradas > 0 && (
                      <>
                        {' · '}
                        <strong className="text-amber-700">{item.ignoradas}</strong> já existia(m)
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Concluir</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {descricao} Regras que já existem no perfil de destino são mantidas, sem sobrescrever.
            </p>

            {copiar.isError && (
              <ErrorAlert title="Erro ao copiar" message={getErrorMessage(copiar.error)} />
            )}

            <fieldset className="space-y-2">
              <legend className="sr-only">Perfis de destino</legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
                <input
                  type="checkbox"
                  checked={todos}
                  onChange={(event) => setTodos(event.target.checked)}
                />
                Todos os demais perfis ({outrosPerfis.length})
              </label>
              {!todos && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {outrosPerfis.map((perfil) => (
                    <label
                      key={perfil.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selecionados.includes(perfil.id)}
                        onChange={() => alternar(perfil.id)}
                      />
                      {perfil.nome}
                    </label>
                  ))}
                </div>
              )}
              {outrosPerfis.length === 0 && !perfisQuery.isLoading && (
                <p className="text-xs text-slate-500">Não há outros perfis cadastrados.</p>
              )}
            </fieldset>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => copiar.mutate()}
                isLoading={copiar.isPending}
                disabled={!podeCopiar}
              >
                Copiar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
