import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  Info,
  CheckCircle2,
  SlidersHorizontal,
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
        title="Exclusões da Antecipação Parcial (NCM + Descrição & Condição Numérica)"
        subtitle="Configuração de mercadorias desconsideradas da apuração na Parcial por isenção, imposto pago na entrada ou alíquotas iguais."
        summary={<span>{regras.data?.length ?? 0} regra(s) em {ufSelecionada}</span>}
        headerAction={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-28">
              <Select
                value={ufSelecionada}
                onChange={(e) => setUfSelecionada(e.target.value)}
                options={UFS_BRASIL.map((u) => ({ value: u, label: `UF: ${u}` }))}
              />
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
                leftIcon={<Sparkles className="w-3.5 h-3.5 text-amber-600" />}
              >
                Carregar Padrão (BA)
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleOpenCreate}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Nova Regra de Exclusão
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Card explicativo sobre a mecânica de casamento e alíquotas iguais */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold text-slate-900">Como funciona a exclusão da Parcial:</span>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-600">
                  <li>
                    <strong>Exclusão por Mercadoria:</strong> exige o <strong>NCM exato</strong> e que <strong>TODAS</strong> as palavras cadastradas na linha apareçam na descrição da nota (em qualquer ordem).
                  </li>
                  <li>
                    <strong>Variações (OU):</strong> para atender nomes alternativos do mesmo produto, cadastre uma nova regra para o mesmo NCM.
                  </li>
                  <li>
                    <strong>Condição Numérica de Alíquotas Iguais:</strong> se A.ORI = A.DST e o valor devido final for zero ou negativo, o item é desconsiderado com conferência. Se houver diferença positiva (IPI, frete, etc.), o item participa da apuração.
                  </li>
                </ul>
              </div>
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
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                {sucessoMsg}
              </span>
              <button
                type="button"
                className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 cursor-pointer"
                onClick={() => setSucessoMsg(null)}
              >
                ✕
              </button>
            </div>
          )}

          {regras.isLoading ? (
            <div className="py-6">
              <LoadingSpinner size="sm" message="Carregando regras de exclusão da Parcial..." />
            </div>
          ) : regras.data && regras.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs divide-y divide-slate-100">
                <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">UF</th>
                    <th className="py-2.5 px-3 font-mono">NCM</th>
                    <th className="py-2.5 px-3">Mercadoria</th>
                    <th className="py-2.5 px-3">Palavras Obrigatórias (TODAS)</th>
                    <th className="py-2.5 px-3">Motivo da Exclusão</th>
                    <th className="py-2.5 px-3 text-center">Situação</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/80">
                  {regras.data.map((regra) => (
                    <tr
                      key={regra.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        !regra.ativo ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                          {regra.uf}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                        {regra.ncm}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {regra.descricao || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {regra.termos_obrigatorios.map((termo, idx) => (
                            <span
                              key={idx}
                              className="font-mono bg-blue-50 text-blue-800 border border-blue-200/80 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            >
                              {termo}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant={MOTIVO_BADGE_VARIANTS[regra.motivo] || 'neutral'}
                          size="sm"
                        >
                          {MOTIVO_LABELS[regra.motivo] || regra.motivo}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleAtivo(regra)}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-colors ${
                            regra.ativo
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                          }`}
                        >
                          {regra.ativo ? 'Ativo' : 'Inativo'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(regra)}
                            className="p-1 rounded text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Editar regra"
                            aria-label={`Editar regra ${regra.ncm}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRegraParaExcluir(regra)}
                            className="p-1 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Excluir regra"
                            aria-label={`Excluir regra ${regra.ncm}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 space-y-2">
              <SlidersHorizontal className="w-6 h-6 text-slate-400 mx-auto" />
              <p>Nenhuma regra de exclusão cadastrada para {ufSelecionada} neste perfil.</p>
              {ufSelecionada === 'BA' && (
                <p className="text-slate-400">
                  Clique em <strong>"Carregar Padrão (BA)"</strong> para carregar as 7 mercadorias iniciais aprovadas.
                </p>
              )}
            </div>
          )}
        </div>
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
