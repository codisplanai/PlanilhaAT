import React from 'react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { DESTINO_CFOP_LABELS, UFS_BRASIL } from '../../constants/domain';
import type { PerfilRegras } from '../../types/perfil';
import type { RegraAliquota } from '../../types/regra';
import type { DestinoCfop, RegraCfopEfetiva } from '../../types/regraCfop';

interface PerfilFormFields {
  nome: string;
  descricao?: string;
  limitar_a_ori_reducoes?: boolean;
}

interface RegraFormFields {
  uf: string;
  tipo_regra: 'padrao' | 'excecao';
  ncm?: string;
  aliquota: number;
  descricao?: string;
}

interface RegraCfopFormFields {
  cfop_sufixo: string;
  destino: DestinoCfop;
  descricao?: string;
}

interface PerfisRegrasModalsProps {
  activePerfil: PerfilRegras | null;
  errorMessage: string | null;
  setErrorMessage: (value: string | null) => void;
  perfilModalOpen: boolean;
  setPerfilModalOpen: (open: boolean) => void;
  editingPerfil: PerfilRegras | null;
  duplicatingPerfil: PerfilRegras | null;
  submitPerfil: React.FormEventHandler<HTMLFormElement>;
  registerPerfil: UseFormRegister<PerfilFormFields>;
  errorsPerfil: FieldErrors<PerfilFormFields>;
  isSubmittingPerfil: boolean;
  regraModalOpen: boolean;
  setRegraModalOpen: (open: boolean) => void;
  editingRegra: RegraAliquota | null;
  tipoRegraWatch: 'padrao' | 'excecao';
  submitRegra: React.FormEventHandler<HTMLFormElement>;
  registerRegra: UseFormRegister<RegraFormFields>;
  errorsRegra: FieldErrors<RegraFormFields>;
  isSubmittingRegra: boolean;
  regraCfopModalOpen: boolean;
  setRegraCfopModalOpen: (open: boolean) => void;
  editingRegraCfop: RegraCfopEfetiva | null;
  submitRegraCfop: React.FormEventHandler<HTMLFormElement>;
  registerRegraCfop: UseFormRegister<RegraCfopFormFields>;
  errorsRegraCfop: FieldErrors<RegraCfopFormFields>;
  isSubmittingRegraCfop: boolean;
  perfilParaExcluir: PerfilRegras | null;
  confirmDeletePerfil: () => void;
  cancelDeletePerfil: () => void;
  isDeletingPerfil: boolean;
  regraParaExcluir: RegraAliquota | null;
  confirmDeleteRegra: () => void;
  cancelDeleteRegra: () => void;
  isDeletingRegra: boolean;
  regraCfopParaExcluir: RegraCfopEfetiva | null;
  confirmDeleteRegraCfop: () => void;
  cancelDeleteRegraCfop: () => void;
  isDeletingRegraCfop: boolean;
}

export const PerfisRegrasModals: React.FC<PerfisRegrasModalsProps> = ({
  activePerfil,
  errorMessage,
  setErrorMessage,
  perfilModalOpen,
  setPerfilModalOpen,
  editingPerfil,
  duplicatingPerfil,
  submitPerfil,
  registerPerfil,
  errorsPerfil,
  isSubmittingPerfil,
  regraModalOpen,
  setRegraModalOpen,
  editingRegra,
  tipoRegraWatch,
  submitRegra,
  registerRegra,
  errorsRegra,
  isSubmittingRegra,
  regraCfopModalOpen,
  setRegraCfopModalOpen,
  editingRegraCfop,
  submitRegraCfop,
  registerRegraCfop,
  errorsRegraCfop,
  isSubmittingRegraCfop,
  perfilParaExcluir,
  confirmDeletePerfil,
  cancelDeletePerfil,
  isDeletingPerfil,
  regraParaExcluir,
  confirmDeleteRegra,
  cancelDeleteRegra,
  isDeletingRegra,
  regraCfopParaExcluir,
  confirmDeleteRegraCfop,
  cancelDeleteRegraCfop,
  isDeletingRegraCfop,
}) => (
  <>
    {/* Modal Perfil */}
    <Modal
      isOpen={perfilModalOpen}
      onClose={() => setPerfilModalOpen(false)}
      title={duplicatingPerfil ? 'Duplicar Perfil de Regras' : editingPerfil ? 'Editar Perfil de Regras' : 'Novo Perfil de Regras'}
      subtitle={duplicatingPerfil ? `Cópia de ${duplicatingPerfil.nome}: inclui todas as regras, exceções e configurações. As empresas permanecem no perfil original.` : 'Perfis agrupam conjuntos de regras e alíquotas compartilhados entre várias empresas'}
    >
      {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
      <form onSubmit={submitPerfil} className="space-y-4">
        <Input
          label="Nome do Perfil"
          placeholder="Ex: Comércio Varejista BA - Geral"
          {...registerPerfil('nome')}
          error={errorsPerfil.nome?.message}
        />
        {!duplicatingPerfil && (
          <>
            <Input
              label="Descrição (Opcional)"
              placeholder="Ex: Perfil padrão para empresas de vestuário e calçados"
              {...registerPerfil('descricao')}
              error={errorsPerfil.descricao?.message}
            />
            <div className="p-3.5 rounded-xl border border-slate-200/90 bg-slate-50/70 flex items-start gap-3">
              <input
                type="checkbox"
                id="limitar_a_ori_reducoes"
                {...registerPerfil('limitar_a_ori_reducoes')}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="limitar_a_ori_reducoes" className="text-xs text-slate-700 select-none cursor-pointer">
                <span className="font-bold text-slate-900 block mb-0.5">
                  Limitar Alíquota de Origem (A.ORI) a 10% em Reduções e Termo de Acordo
                </span>
                <span className="text-slate-500 leading-relaxed block">
                  Quando ativo, alíquotas interestaduais superiores a 10% (como 12%) são automaticamente limitadas a 10% nos cálculos fiscais e no preenchimento da planilha para itens de notas sob Redução ou Termo de Acordo. Exceção: na Antecipação Parcial, se a alíquota do XML for igual à de destino (ex.: 12% e 12%), o limite não é aplicado, o imposto fica zero e o item pode ser excluído pela regra de alíquotas iguais.
                </span>
              </label>
            </div>
          </>
        )}
        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setPerfilModalOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmittingPerfil}>
            {duplicatingPerfil ? 'Duplicar Perfil' : 'Salvar Perfil'}
          </Button>
        </div>
      </form>
    </Modal>

    {/* Modal Regra de Alíquota */}
    <Modal
      isOpen={regraModalOpen}
      onClose={() => setRegraModalOpen(false)}
      title={
        editingRegra
          ? 'Editar Regra de Alíquota'
          : tipoRegraWatch === 'excecao'
          ? 'Cadastrar Exceção por NCM'
          : 'Cadastrar Alíquota Padrão da UF'
      }
      subtitle={`Perfil: ${activePerfil?.nome}`}
    >
      {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
      <form onSubmit={submitRegra} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-2">
            Tipo da Regra
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label
              className={`flex items-center gap-2 p-3.5 rounded-xl border cursor-pointer text-xs font-semibold transition-all ${
                tipoRegraWatch === 'padrao'
                  ? 'bg-blue-50 border-blue-600 text-blue-950 font-bold shadow-2xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                value="padrao"
                className="text-blue-600 focus:ring-blue-500 h-4 w-4"
                {...registerRegra('tipo_regra')}
              />
              <span>Padrão do Estado (UF)</span>
            </label>

            <label
              className={`flex items-center gap-2 p-3.5 rounded-xl border cursor-pointer text-xs font-semibold transition-all ${
                tipoRegraWatch === 'excecao'
                  ? 'bg-purple-50 border-purple-600 text-purple-950 font-bold shadow-2xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                value="excecao"
                className="text-purple-600 focus:ring-purple-500 h-4 w-4"
                {...registerRegra('tipo_regra')}
              />
              <span>Exceção por NCM</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Estado (UF)"
            options={UFS_BRASIL.map((uf) => ({ value: uf, label: uf }))}
            {...registerRegra('uf')}
            error={errorsRegra.uf?.message}
          />

          <div>
            <Input
              label="Alíquota de Destino A.DST (%)"
              type="number"
              step="0.01"
              placeholder="Ex: 20.5 ou 18.0"
              {...registerRegra('aliquota', { valueAsNumber: true })}
              error={errorsRegra.aliquota?.message}
              helperText="Informe o percentual (ex: 20.5 para 20,5%)"
            />
          </div>
        </div>

        {tipoRegraWatch === 'excecao' && (
          <div>
            <Input
              label="Código NCM ou prefixo (4 a 8 dígitos)"
              placeholder="Ex: 2203 ou 84713012"
              maxLength={12}
              {...registerRegra('ncm')}
              error={errorsRegra.ncm?.message}
              helperText="Informe de 4 a 8 dígitos numéricos (ex.: 2203 para toda a posição ou 84713012 exato). Quando houver sobreposição, o prefixo mais longo (mais específico) vence."
            />
          </div>
        )}

        <div>
          <Input
            label="Descrição / Motivo da Alíquota"
            placeholder="Ex: Alíquota interna BA com adicional de FECOP"
            {...registerRegra('descricao')}
            error={errorsRegra.descricao?.message}
          />
        </div>

        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setRegraModalOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmittingRegra}>
            {editingRegra ? 'Salvar Alterações' : 'Salvar Regra'}
          </Button>
        </div>
      </form>
    </Modal>

    {/* Modal Regra de CFOP */}
    <Modal
      isOpen={regraCfopModalOpen}
      onClose={() => setRegraCfopModalOpen(false)}
      title={editingRegraCfop ? 'Sobrescrever Roteamento de CFOP' : 'Nova Exceção de Roteamento por CFOP'}
      subtitle={`Perfil: ${activePerfil?.nome}`}
    >
      {errorMessage && <ErrorAlert message={errorMessage} onDismiss={() => setErrorMessage(null)} />}
      <form onSubmit={submitRegraCfop} className="space-y-4">
        <Input
          label="CFOP (3 últimos dígitos ou completo)"
          placeholder="Ex: 102 ou 6102"
          maxLength={4}
          {...registerRegraCfop('cfop_sufixo')}
          error={errorsRegraCfop.cfop_sufixo?.message}
          helperText="O mesmo sufixo casa tanto com o CFOP de saída do XML (6xxx) quanto com o de entrada do SPED (2xxx)"
        />

        <div>
          <Select
            label="Planilha de Destino"
            options={(Object.keys(DESTINO_CFOP_LABELS) as DestinoCfop[]).map((d) => ({
              value: d,
              label: DESTINO_CFOP_LABELS[d],
            }))}
            {...registerRegraCfop('destino')}
          />
        </div>

        <Input
          label="Descrição (Opcional)"
          placeholder="Ex: Mercadoria sujeita a ST"
          {...registerRegraCfop('descricao')}
          error={errorsRegraCfop.descricao?.message}
        />

        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => setRegraCfopModalOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" isLoading={isSubmittingRegraCfop}>
            Salvar Regra
          </Button>
        </div>
      </form>
    </Modal>

    {/* Confirmação de Exclusão de Perfil */}
    <ConfirmDialog
      isOpen={Boolean(perfilParaExcluir)}
      onClose={cancelDeletePerfil}
      onConfirm={confirmDeletePerfil}
      title="Excluir Perfil de Regras"
      message={`Tem certeza de que deseja remover o perfil "${perfilParaExcluir?.nome}"? Todas as regras deste perfil serão removidas permanentemente.`}
      confirmLabel="Sim, Excluir Perfil"
      cancelLabel="Cancelar"
      variant="danger"
      isLoading={isDeletingPerfil}
    />

    {/* Confirmação de Exclusão de Regra Alíquota */}
    <ConfirmDialog
      isOpen={Boolean(regraParaExcluir)}
      onClose={cancelDeleteRegra}
      onConfirm={confirmDeleteRegra}
      title="Excluir Regra de Alíquota"
      message={`Tem certeza de que deseja remover a regra para o estado "${regraParaExcluir?.uf}" ${regraParaExcluir?.ncm ? `(NCM ${regraParaExcluir.ncm})` : '(padrão)'}?`}
      confirmLabel="Sim, Excluir Regra"
      cancelLabel="Cancelar"
      variant="danger"
      isLoading={isDeletingRegra}
    />

    {/* Confirmação de Exclusão de Regra CFOP */}
    <ConfirmDialog
      isOpen={Boolean(regraCfopParaExcluir)}
      onClose={cancelDeleteRegraCfop}
      onConfirm={confirmDeleteRegraCfop}
      title="Remover Exceção de CFOP"
      message={`Tem certeza de que deseja remover a exceção para o CFOP ${regraCfopParaExcluir?.cfop_sufixo}? O roteamento voltará ao padrão do sistema.`}
      confirmLabel="Sim, Remover Exceção"
      cancelLabel="Cancelar"
      variant="danger"
      isLoading={isDeletingRegraCfop}
    />
  </>
);

