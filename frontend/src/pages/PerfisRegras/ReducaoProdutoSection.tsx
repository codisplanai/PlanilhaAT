import React, { useState } from 'react';
import { Check, Percent, Plus, Trash2, TriangleAlert, X } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Select } from '../../components/ui/Select';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { useReducaoProdutoSection } from './useReducaoProdutoSection';
import type { RegraReducao } from '../../types/regraReducao';
import { parseCommaSeparatedTerms } from '../../lib/terms';

const AJUDA_TERMOS =
  'Separe por vírgula. Use * no fim para casar prefixo: vergalh* pega VERGALHAO e ' +
  'VERGALHOES. O termo casa palavras inteiras — ferro não casa FERROVIARIO.';

const percentual = (aliquota: number): string => `${(aliquota * 100).toFixed(2)}%`;

interface Props {
  perfilId: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  marker?: React.ReactNode;
}

export const ReducaoProdutoSection: React.FC<Props> = ({ perfilId, open, onOpenChange, marker }) => {
  const { regras, criarRegra, deletarRegra, criarExcecao, deletarExcecao, erro, setErro } =
    useReducaoProdutoSection(perfilId);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraDaExcecao, setRegraDaExcecao] = useState<RegraReducao | null>(null);
  const [regraParaExcluir, setRegraParaExcluir] = useState<RegraReducao | null>(null);
  const [excecaoParaExcluir, setExcecaoParaExcluir] = useState<{
    regraId: number;
    excecaoId: number;
    descricao: string;
  } | null>(null);

  const [ncm, setNcm] = useState('');
  const [inclusao, setInclusao] = useState('');
  const [exclusao, setExclusao] = useState('');
  const [aliquota, setAliquota] = useState('');
  const [descricao, setDescricao] = useState('');

  const [descricaoExata, setDescricaoExata] = useState('');
  const [enquadrado, setEnquadrado] = useState('nao');
  const [observacao, setObservacao] = useState('');

  const limparFormRegra = () => {
    setNcm(''); setInclusao(''); setExclusao(''); setAliquota(''); setDescricao('');
  };

  const submeterRegra = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    criarRegra.mutate(
      {
        perfil_regras_id: perfilId,
        ncm,
        termos_inclusao: parseCommaSeparatedTerms(inclusao),
        termos_exclusao: parseCommaSeparatedTerms(exclusao),
        aliquota: Number(aliquota.replace(',', '.')),
        descricao: descricao || null,
      },
      { onSuccess: () => { limparFormRegra(); setModalRegraAberto(false); } },
    );
  };

  const submeterExcecao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regraDaExcecao) return;
    setErro(null);
    criarExcecao.mutate(
      {
        regraId: regraDaExcecao.id,
        payload: {
          descricao_exata: descricaoExata,
          enquadrado: enquadrado === 'sim',
          observacao: observacao || null,
        },
      },
      {
        onSuccess: () => {
          setDescricaoExata(''); setObservacao(''); setEnquadrado('nao');
          setRegraDaExcecao(null);
        },
      },
    );
  };

  return (
    <>
      <Card
        collapsible
        open={open}
        onOpenChange={onOpenChange}
        marker={marker}
        bodyPadding="none"
        title="Reduções por Produto"
        subtitle="Aplicada quando o NCM e a descrição do item conferem. Vence o termo de acordo da empresa e as demais regras."
        summary={<span>{regras.data?.length ?? 0} regra(s)</span>}
        headerAction={
          <Button
            size="sm"
            onClick={() => { setErro(null); setModalRegraAberto(true); }}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Nova redução
          </Button>
        }
      >
        {regras.data && regras.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-slate-100 text-left text-xs">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-mono">NCM</th>
                  <th className="px-3 py-2.5">Termos de inclusão</th>
                  <th className="px-3 py-2.5">Termos de exclusão</th>
                  <th className="px-3 py-2.5 text-right">Alíquota</th>
                  <th className="px-3 py-2.5">Descrição</th>
                  <th className="px-3 py-2.5">Exceções por descrição</th>
                  <th className="px-3 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {regras.data.map((regra) => (
                  <tr key={regra.id} className="align-top transition-colors hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-800">
                        {regra.ncm}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {regra.termos_inclusao.map((termo) => (
                          <span
                            key={termo}
                            className="rounded border border-blue-200/80 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-800"
                          >
                            {termo}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {regra.termos_exclusao.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {regra.termos_exclusao.map((termo) => (
                            <span
                              key={termo}
                              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                            >
                              {termo}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-blue-950">
                      {percentual(regra.aliquota)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{regra.descricao || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        {regra.excecoes.map((exc) => (
                          <div key={exc.id} className="flex items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                                exc.enquadrado
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                                  : 'bg-amber-50 text-amber-800 ring-amber-600/20'
                              }`}
                              title={exc.enquadrado ? 'Enquadrada na redução' : 'Fora da redução'}
                            >
                              {exc.enquadrado ? (
                                <Check className="h-3 w-3 shrink-0" />
                              ) : (
                                <X className="h-3 w-3 shrink-0" />
                              )}
                              {exc.descricao_exata}
                            </span>
                            <button
                              type="button"
                              className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Remover exceção ${exc.descricao_exata}`}
                              onClick={() =>
                                setExcecaoParaExcluir({
                                  regraId: regra.id,
                                  excecaoId: exc.id,
                                  descricao: exc.descricao_exata,
                                })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-0 px-2 py-1"
                          onClick={() => { setErro(null); setRegraDaExcecao(regra); }}
                          leftIcon={<Plus className="h-3 w-3" />}
                        >
                          Exceção
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setRegraParaExcluir(regra)}
                        className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                        title="Excluir redução"
                        aria-label={`Excluir redução do NCM ${regra.ncm}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <SectionEmpty
              icon={<Percent className="h-6 w-6" />}
              title="Nenhuma redução por produto"
              hint="Sem regra aqui, todos os produtos usam o termo de acordo da empresa ou a alíquota padrão do estado."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setErro(null); setModalRegraAberto(true); }}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Cadastrar redução
                </Button>
              }
            />
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalRegraAberto}
        onClose={() => setModalRegraAberto(false)}
        title="Nova redução por produto"
        subtitle="A regra só se aplica quando o NCM e a descrição do item conferem."
      >
        <form onSubmit={submeterRegra} className="space-y-4">
          {erro && (
            <ErrorAlert
              title="Erro ao cadastrar redução"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}
          <Input
            label="NCM"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="72142000"
            required
          />
          <Input
            label="Termos de inclusão"
            value={inclusao}
            onChange={(e) => setInclusao(e.target.value)}
            placeholder="vergalh*, verg ca"
            helperText={AJUDA_TERMOS}
            required
          />
          <Input
            label="Termos de exclusão (opcional)"
            value={exclusao}
            onChange={(e) => setExclusao(e.target.value)}
            placeholder="cobre, aluminio"
            helperText="Se algum destes casar, a regra é descartada para o item."
          />
          <Input
            label="Alíquota"
            value={aliquota}
            onChange={(e) => setAliquota(e.target.value)}
            placeholder="12,00"
            helperText="Aceita 12 ou 0.12."
            required
          />
          <Input
            label="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Vergalhões — Decreto 12.345"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalRegraAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarRegra.isPending}>
              Cadastrar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={regraDaExcecao !== null}
        onClose={() => setRegraDaExcecao(null)}
        title="Exceção para uma descrição específica"
        subtitle="Avaliada antes dos termos: resolve o caso que a regra erra, sem alterar a regra."
      >
        <form onSubmit={submeterExcecao} className="space-y-4">
          {erro && (
            <ErrorAlert
              title="Erro ao cadastrar exceção"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}
          <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3">
            <TriangleAlert className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              Informe a descrição como ela aparece na nota. Acento, caixa e pontuação são
              normalizados automaticamente.
            </span>
          </div>
          <Input
            label="Descrição exata"
            value={descricaoExata}
            onChange={(e) => setDescricaoExata(e.target.value)}
            placeholder="VERGALHAO DE COBRE"
            required
          />
          <Select
            label="Este produto se enquadra na redução?"
            value={enquadrado}
            onChange={(e) => setEnquadrado(e.target.value)}
            options={[
              { value: 'nao', label: 'Não — usar a alíquota normal' },
              { value: 'sim', label: 'Sim — aplicar a redução' },
            ]}
          />
          <Input
            label="Observação (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Cobre não entra no decreto"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRegraDaExcecao(null)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarExcecao.isPending}>
              Cadastrar exceção
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(regraParaExcluir)}
        onClose={() => setRegraParaExcluir(null)}
        onConfirm={() => {
          if (regraParaExcluir) {
            deletarRegra.mutate(regraParaExcluir.id, {
              onSuccess: () => setRegraParaExcluir(null),
            });
          }
        }}
        title="Excluir Redução por Produto"
        message={`Deseja remover permanentemente a redução para o NCM ${regraParaExcluir?.ncm}?`}
        confirmLabel="Sim, Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={deletarRegra.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(excecaoParaExcluir)}
        onClose={() => setExcecaoParaExcluir(null)}
        onConfirm={() => {
          if (excecaoParaExcluir) {
            deletarExcecao.mutate(
              { regraId: excecaoParaExcluir.regraId, excecaoId: excecaoParaExcluir.excecaoId },
              { onSuccess: () => setExcecaoParaExcluir(null) },
            );
          }
        }}
        title="Remover Exceção de Descrição"
        message={`Deseja remover a exceção para "${excecaoParaExcluir?.descricao}"?`}
        confirmLabel="Sim, Remover"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={deletarExcecao.isPending}
      />
    </>
  );
};
