import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  Info,
  CheckCircle2,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { UFS_BRASIL } from '../../constants/domain';
import { useExclusaoParcialSection } from './useExclusaoParcialSection';
import type {
  MotivoExclusaoParcial,
  RegraExclusaoParcial,
} from '../../types/regraExclusaoParcial';
import { parseCommaSeparatedTerms } from '../../lib/terms';

const AJUDA_TERMOS =
  'Separe por vírgula. Todas as palavras listadas precisam constar na descrição do item (regra E). ' +
  'Exemplo: "mistura, bolo" exige ambas as palavras. Para variações alternativas (regra OU), cadastre uma nova linha.';

const MOTIVO_LABELS: Record<MotivoExclusaoParcial, string> = {
  isencao: 'Isenção',
  imposto_pago_entrada: 'Imposto pago na entrada',
};

const MOTIVO_BADGE_VARIANTS: Record<MotivoExclusaoParcial, 'info' | 'warning' | 'neutral' | 'success'> = {
  isencao: 'info',
  imposto_pago_entrada: 'warning',
};

interface Props {
  perfilId: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const ExclusaoParcialSection: React.FC<Props> = ({ perfilId, open, onOpenChange }) => {
  const {
    ufSelecionada,
    setUfSelecionada,
    regras,
    criarRegra,
    atualizarRegra,
    deletarRegra,
    carregarPadraoBa,
    erro,
    setErro,
    sucessoMsg,
    setSucessoMsg,
  } = useExclusaoParcialSection(perfilId);

  const [modalAberto, setModalAberto] = useState(false);
  const [editingRegra, setEditingRegra] = useState<RegraExclusaoParcial | null>(null);
  const [regraParaExcluir, setRegraParaExcluir] = useState<RegraExclusaoParcial | null>(null);

  // Campos do formulário
  const [uf, setUf] = useState('BA');
  const [ncm, setNcm] = useState('');
  const [descricao, setDescricao] = useState('');
  const [termosTexto, setTermosTexto] = useState('');
  const [motivo, setMotivo] = useState<MotivoExclusaoParcial>('isencao');
  const [ativo, setAtivo] = useState(true);

  const limparForm = () => {
    setEditingRegra(null);
    setUf(ufSelecionada);
    setNcm('');
    setDescricao('');
    setTermosTexto('');
    setMotivo('isencao');
    setAtivo(true);
  };

  const handleOpenCreate = () => {
    limparForm();
    setErro(null);
    setModalAberto(true);
  };

  const handleOpenEdit = (regra: RegraExclusaoParcial) => {
    setEditingRegra(regra);
    setUf(regra.uf);
    setNcm(regra.ncm);
    setDescricao(regra.descricao || '');
    setTermosTexto(regra.termos_obrigatorios.join(', '));
    setMotivo(regra.motivo);
    setAtivo(regra.ativo);
    setErro(null);
    setModalAberto(true);
  };

  const submeterForm = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    const termos = parseCommaSeparatedTerms(termosTexto, true);
    if (termos.length === 0) {
      setErro('Informe ao menos uma palavra/termo obrigatório.');
      return;
    }

    if (editingRegra) {
      atualizarRegra.mutate(
        {
          id: editingRegra.id,
          payload: {
            uf,
            ncm: ncm.replace(/\D/g, ''),
            descricao: descricao.trim() || null,
            termos_obrigatorios: termos,
            motivo,
            ativo,
          },
        },
        {
          onSuccess: () => {
            limparForm();
            setModalAberto(false);
          },
        }
      );
    } else {
      criarRegra.mutate(
        {
          perfil_regras_id: perfilId,
          uf,
          ncm: ncm.replace(/\D/g, ''),
          descricao: descricao.trim() || null,
          termos_obrigatorios: termos,
          motivo,
          ativo,
        },
        {
          onSuccess: () => {
            limparForm();
            setModalAberto(false);
          },
        }
      );
    }
  };

  const handleToggleAtivo = (regra: RegraExclusaoParcial) => {
    atualizarRegra.mutate({
      id: regra.id,
      payload: { ativo: !regra.ativo },
    });
  };

  return (
    <>
      <Card
        collapsible
        open={open}
        onOpenChange={onOpenChange}
        bodyPadding="none"
        title="Exclusões da Antecipação Parcial"
        subtitle="Mercadorias desconsideradas da apuração por isenção, imposto pago na entrada ou alíquotas iguais."
        summary={
          <span>
            {regras.data?.length ?? 0} regra(s) em{' '}
            <span className="font-mono font-semibold text-slate-700">{ufSelecionada}</span>
          </span>
        }
        headerAction={
          <Button
            size="sm"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Nova regra de exclusão
          </Button>
        }
      >
        <div className="space-y-4 p-5 pb-0">
          {/* Mecânica do casamento: a regra que mais gera dúvida no cadastro */}
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <div className="min-w-0 space-y-1.5 leading-relaxed">
              <p className="font-bold text-slate-900">Como a exclusão é decidida</p>
              <ul className="list-inside list-disc space-y-1 text-slate-600">
                <li>
                  <strong className="font-semibold text-slate-800">Por mercadoria:</strong> exige o NCM
                  exato e que <strong className="font-semibold text-slate-800">todas</strong> as palavras
                  da linha apareçam na descrição da nota, em qualquer ordem.
                </li>
                <li>
                  <strong className="font-semibold text-slate-800">Nomes alternativos:</strong> cadastre
                  uma nova linha para o mesmo NCM — linhas diferentes valem como &ldquo;ou&rdquo;.
                </li>
                <li>
                  <strong className="font-semibold text-slate-800">Alíquotas iguais:</strong> com A.ORI =
                  A.DST e valor devido zero ou negativo, o item sai com registro de conferência. Havendo
                  diferença positiva por IPI ou frete, ele permanece na apuração.
                </li>
              </ul>
            </div>
          </div>

          {erro && (
            <ErrorAlert
              title="Erro na operação"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}

          {sucessoMsg && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                {sucessoMsg}
              </span>
              <button
                type="button"
                aria-label="Fechar aviso"
                className="cursor-pointer rounded p-1 text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900"
                onClick={() => setSucessoMsg(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Filtro junto dos dados que ele filtra, não no cabeçalho do card */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <label
                htmlFor="exclusao-parcial-uf"
                className="text-xs font-semibold text-slate-600"
              >
                Estado
              </label>
              <select
                id="exclusao-parcial-uf"
                value={ufSelecionada}
                onChange={(e) => setUfSelecionada(e.target.value)}
                className="cursor-pointer rounded-lg border border-slate-200/90 bg-white py-1.5 pl-2.5 pr-8 font-mono text-xs font-semibold text-slate-900 shadow-2xs transition-all hover:border-slate-300 focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-500/15"
              >
                {UFS_BRASIL.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            {ufSelecionada === 'BA' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setErro(null);
                  carregarPadraoBa.mutate(perfilId);
                }}
                isLoading={carregarPadraoBa.isPending}
                leftIcon={<Sparkles className="h-3.5 w-3.5 text-amber-600" />}
              >
                Carregar padrão da Bahia
              </Button>
            )}
          </div>
        </div>

        {regras.isLoading ? (
          <div className="p-5">
            <LoadingSpinner size="sm" message="Carregando regras de exclusão da Parcial..." />
          </div>
        ) : regras.data && regras.data.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full divide-y divide-slate-100 text-left text-xs">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">UF</th>
                  <th className="px-3 py-2.5 font-mono">NCM</th>
                  <th className="px-3 py-2.5">Mercadoria</th>
                  <th className="px-3 py-2.5">Palavras obrigatórias</th>
                  <th className="px-3 py-2.5">Motivo</th>
                  <th className="px-3 py-2.5 text-center">Situação</th>
                  <th className="px-3 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {regras.data.map((regra) => (
                  <tr
                    key={regra.id}
                    className={`transition-colors hover:bg-slate-50/70 ${
                      !regra.ativo ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-800">
                        {regra.uf}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-800">
                      {regra.ncm}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {regra.descricao || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {regra.termos_obrigatorios.map((termo, idx) => (
                          <span
                            key={idx}
                            className="rounded border border-blue-200/80 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-800"
                          >
                            {termo}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={MOTIVO_BADGE_VARIANTS[regra.motivo] || 'neutral'}
                        size="sm"
                      >
                        {MOTIVO_LABELS[regra.motivo] || regra.motivo}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleAtivo(regra)}
                        aria-pressed={regra.ativo}
                        title={regra.ativo ? 'Desativar regra' : 'Ativar regra'}
                        className={`inline-flex cursor-pointer items-center rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${
                          regra.ativo
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                      >
                        {regra.ativo ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(regra)}
                          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700"
                          title="Editar regra"
                          aria-label={`Editar regra ${regra.ncm}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRegraParaExcluir(regra)}
                          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                          title="Excluir regra"
                          aria-label={`Excluir regra ${regra.ncm}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <SectionEmpty
              icon={<SlidersHorizontal className="h-6 w-6" />}
              title={`Nenhuma exclusão cadastrada para ${ufSelecionada}`}
              hint={
                ufSelecionada === 'BA'
                  ? 'Carregue as 7 mercadorias iniciais aprovadas para a Bahia ou cadastre a primeira regra.'
                  : 'Todos os itens desta UF seguem para a apuração da Parcial.'
              }
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenCreate}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Cadastrar regra de exclusão
                </Button>
              }
            />
          </div>
        )}
      </Card>

      {/* Modal Criar/Editar Regra */}
      <Modal
        isOpen={modalAberto}
        onClose={() => {
          setModalAberto(false);
          limparForm();
        }}
        title={editingRegra ? 'Editar Regra de Exclusão da Parcial' : 'Nova Regra de Exclusão da Parcial'}
        subtitle="Define NCM e palavras obrigatórias da descrição para desconsiderar a mercadoria da Parcial."
        maxWidth="md"
      >
        <form onSubmit={submeterForm} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="UF de Destino *"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              options={UFS_BRASIL.map((u) => ({ value: u, label: u }))}
            />
            <Input
              label="NCM (8 dígitos) *"
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="Ex: 02102000"
              maxLength={8}
              required
            />
          </div>

          <Input
            label="Mercadoria / Descrição de Referência"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: Charque, Mistura para bolo"
          />

          <div>
            <Input
              label="Palavras Obrigatórias (TODAS na mesma linha) *"
              value={termosTexto}
              onChange={(e) => setTermosTexto(e.target.value)}
              placeholder="Ex: mistura, bolo"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{AJUDA_TERMOS}</p>
          </div>

          <Select
            label="Motivo da Exclusão *"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoExclusaoParcial)}
            options={[
              { value: 'isencao', label: 'Isenção' },
              { value: 'imposto_pago_entrada', label: 'Imposto pago na entrada' },
            ]}
          />

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="regra-ativo"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
            />
            <label htmlFor="regra-ativo" className="text-xs font-semibold text-slate-800 cursor-pointer">
              Regra ativa para novas apurações
            </label>
          </div>

          {erro && <ErrorAlert message={erro} onDismiss={() => setErro(null)} />}

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalAberto(false);
                limparForm();
              }}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              isLoading={criarRegra.isPending || atualizarRegra.isPending}
            >
              {editingRegra ? 'Salvar Alterações' : 'Criar Regra'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ConfirmDialog Excluir */}
      <ConfirmDialog
        isOpen={Boolean(regraParaExcluir)}
        title="Excluir Regra de Exclusão"
        message={`Deseja realmente excluir a regra para o NCM ${regraParaExcluir?.ncm} (${regraParaExcluir?.descricao || regraParaExcluir?.termos_obrigatorios.join(', ')})?`}
        confirmLabel="Excluir"
        variant="danger"
        isLoading={deletarRegra.isPending}
        onConfirm={() => {
          if (regraParaExcluir) {
            deletarRegra.mutate(regraParaExcluir.id, {
              onSuccess: () => setRegraParaExcluir(null),
            });
          }
        }}
        onClose={() => setRegraParaExcluir(null)}
      />
    </>
  );
};
