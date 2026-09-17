import React, { useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Select } from '../../components/ui/Select';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { useReclassificacaoCfopSection } from './useReclassificacaoCfopSection';
import type { RegraReclassificacaoCfop } from '../../types/regraReclassificacaoCfop';
import { parseCommaSeparatedTerms } from '../../lib/terms';

interface Props {
  perfilId: number;
}

export const ReclassificacaoCfopSection: React.FC<Props> = ({ perfilId }) => {
  const {
    regras,
    criarRegra,
    deletarRegra,
    criarExcecao,
    deletarExcecao,
    erro,
    setErro,
  } = useReclassificacaoCfopSection(perfilId);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraDaExcecao, setRegraDaExcecao] = useState<RegraReclassificacaoCfop | null>(null);
  const [regraParaExcluir, setRegraParaExcluir] = useState<RegraReclassificacaoCfop | null>(null);
  const [excecaoParaExcluir, setExcecaoParaExcluir] = useState<{
    regraId: number;
    excecaoId: number;
    descricao: string;
  } | null>(null);

  const [ncm, setNcm] = useState('');
  const [cfopOrigem, setCfopOrigem] = useState('');
  const [cfopDestino, setCfopDestino] = useState('');
  const [inclusao, setInclusao] = useState('');
  const [exclusao, setExclusao] = useState('');
  const [descricao, setDescricao] = useState('');

  const [descricaoExata, setDescricaoExata] = useState('');
  const [aplicarExcecao, setAplicarExcecao] = useState('nao');
  const [observacao, setObservacao] = useState('');

  const limparFormRegra = () => {
    setNcm('');
    setCfopOrigem('');
    setCfopDestino('');
    setInclusao('');
    setExclusao('');
    setDescricao('');
  };

  const submeterRegra = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    criarRegra.mutate(
      {
        perfil_regras_id: perfilId,
        ncm,
        cfop_origem_sufixo: cfopOrigem.trim() || null,
        cfop_destino_sufixo: cfopDestino.trim(),
        termos_inclusao: parseCommaSeparatedTerms(inclusao),
        termos_exclusao: parseCommaSeparatedTerms(exclusao),
        descricao: descricao.trim() || null,
      },
      {
        onSuccess: () => {
          limparFormRegra();
          setModalRegraAberto(false);
        },
      },
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
          aplicar: aplicarExcecao === 'sim',
          observacao: observacao.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDescricaoExata('');
          setObservacao('');
          setAplicarExcecao('nao');
          setRegraDaExcecao(null);
        },
      },
    );
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="flex justify-between items-center bg-blue-50/40 p-3 rounded-lg border border-blue-100/60">
        <div>
          <h4 className="text-xs font-bold text-blue-950 uppercase tracking-wider">
            Reclassificação de CFOP por NCM / Produto
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Itens que casarem com estas regras terão o CFOP reescrito antes da resolução da planilha.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            limparFormRegra();
            setErro(null);
            setModalRegraAberto(true);
          }}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
        >
          Nova Reclassificação
        </Button>
      </div>

      {regras.data && regras.data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs divide-y divide-slate-100">
            <thead className="bg-slate-50/70 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 font-mono">NCM</th>
                <th className="py-3 px-4 font-mono">CFOP Origem</th>
                <th className="py-3 px-4 font-mono">Novo CFOP</th>
                <th className="py-3 px-4">Termos de Inclusão</th>
                <th className="py-3 px-4">Termos de Exclusão</th>
                <th className="py-3 px-4">Descrição</th>
                <th className="py-3 px-4">Exceções Específicas</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {regras.data.map((regra) => (
                <tr key={regra.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{regra.ncm}</td>
                  <td className="py-3 px-4 font-mono text-slate-600">
                    {regra.cfop_origem_sufixo ? (
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                        {regra.cfop_origem_sufixo}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Qualquer</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-emerald-700">
                    <span className="bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      {regra.cfop_destino_sufixo}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">
                    {regra.termos_inclusao.length > 0 ? (
                      regra.termos_inclusao.join(', ')
                    ) : (
                      <span className="text-slate-400 italic">Todo o NCM</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500">
                    {regra.termos_exclusao.join(', ') || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-600">{regra.descricao || '—'}</td>
                  <td className="py-3 px-4">
                    <div className="space-y-1">
                      {regra.excecoes.map((exc) => (
                        <div key={exc.id} className="flex items-center gap-1.5 text-xs">
                          <span
                            className={exc.aplicar ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}
                          >
                            {exc.aplicar ? '✓' : '✕'} {exc.descricao_exata}
                          </span>
                          <button
                            type="button"
                            className="text-slate-400 hover:text-red-600 cursor-pointer p-0.5"
                            title="Remover exceção"
                            aria-label={`Remover exceção ${exc.descricao_exata}`}
                            onClick={() =>
                              setExcecaoParaExcluir({
                                regraId: regra.id,
                                excecaoId: exc.id,
                                descricao: exc.descricao_exata,
                              })
                            }
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[11px] h-6 px-1.5 text-blue-700 hover:bg-blue-50"
                        onClick={() => {
                          setErro(null);
                          setRegraDaExcecao(regra);
                        }}
                      >
                        + exceção
                      </Button>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-400 hover:text-rose-700"
                      onClick={() => setRegraParaExcluir(regra)}
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      aria-label={`Excluir reclassificação do NCM ${regra.ncm}`}
                    >
                      Excluir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-slate-500 italic py-6 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          Nenhuma reclassificação por produto cadastrada. Todos os itens usam o CFOP que veio na nota.
        </p>
      )}

      {/* Modal Nova Regra */}
      <Modal
        isOpen={modalRegraAberto}
        onClose={() => setModalRegraAberto(false)}
        title="Nova Reclassificação de CFOP por Produto"
        subtitle="Altera o CFOP de itens específicos por NCM e descrição antes do roteamento por planilha"
      >
        <form onSubmit={submeterRegra} className="space-y-4">
          {erro && (
            <ErrorAlert
              title="Erro ao cadastrar reclassificação"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}
          <Input
            label="NCM (8 dígitos)"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="73269090"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="CFOP de Origem (opcional)"
              value={cfopOrigem}
              onChange={(e) => setCfopOrigem(e.target.value)}
              placeholder="Ex: 6102 ou 102"
              helperText="Vazio = qualquer CFOP deste NCM"
            />
            <Input
              label="Novo CFOP Reclassificado"
              value={cfopDestino}
              onChange={(e) => setCfopDestino(e.target.value)}
              placeholder="Ex: 6405 ou 405"
              helperText="CFOP que o item assumirá"
              required
            />
          </div>
          <Input
            label="Termos de inclusão (opcional)"
            value={inclusao}
            onChange={(e) => setInclusao(e.target.value)}
            placeholder="grampo*, presilha"
            helperText="Separe por vírgula. Use * para prefixo. Deixe em branco para valer para todo produto deste NCM."
          />
          <Input
            label="Termos de exclusão (opcional)"
            value={exclusao}
            onChange={(e) => setExclusao(e.target.value)}
            placeholder="plastico, nylon"
            helperText="Se casar algum destes termos, a reclassificação é descartada."
          />
          <Input
            label="Descrição / Motivo (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex: Grampos de aço sujeitos a ST"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalRegraAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarRegra.isPending}>
              Cadastrar Reclassificação
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Nova Exceção */}
      <Modal
        isOpen={regraDaExcecao !== null}
        onClose={() => setRegraDaExcecao(null)}
        title="Exceção para uma descrição específica"
        subtitle="Avaliada com prioridade máxima antes dos termos de descrição"
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
              Informe a descrição como aparece na nota. Acentos, pontuação e maiúsculas são normalizados automaticamente.
            </span>
          </div>
          <Input
            label="Descrição exata do produto"
            value={descricaoExata}
            onChange={(e) => setDescricaoExata(e.target.value)}
            placeholder="GRAMPO ESPECIAL INOX"
            required
          />
          <Select
            label="Ação para este produto"
            value={aplicarExcecao}
            onChange={(e) => setAplicarExcecao(e.target.value)}
            options={[
              { value: 'nao', label: 'Manter o CFOP original da nota (não reclassificar)' },
              { value: 'sim', label: 'Aplicar a reclassificação desta regra' },
            ]}
          />
          <Input
            label="Observação (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Inox não entra no regime de ST"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRegraDaExcecao(null)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarExcecao.isPending}>
              Cadastrar Exceção
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
        title="Excluir Reclassificação"
        message={`Deseja remover permanentemente a reclassificação do NCM ${regraParaExcluir?.ncm} para ${regraParaExcluir?.cfop_destino_sufixo}?`}
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
    </div>
  );
};
