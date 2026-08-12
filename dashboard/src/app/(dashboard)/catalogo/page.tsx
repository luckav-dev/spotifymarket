import { ShoppingBag } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { DialogoNuevoProducto } from './product-form';
import { CatalogEmpty, CatalogTable } from './catalog-table';

export const dynamic = 'force-dynamic';

export default async function PaginaCatalogo() {
  let productos, categorias: string[], fuente: 'local' | 'sellauth';

  try {
    const [resProductos, resShop] = await Promise.all([api.productos(), api.leerConfig('shop')]);
    productos = resProductos.productos;
    fuente = resProductos.fuente;
    categorias = fuente === 'sellauth'
      ? [...new Set(productos.map((producto) => producto.categoria))].sort()
      : (resShop.datos.categorias as string[]) ?? [];
  } catch (error) {
    return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
  }

  const ordenados = [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        eyebrow="Publicación"
        icon={ShoppingBag}
        title="Catálogo"
        description={fuente === 'sellauth'
          ? 'Catalogo sincronizado en modo lectura. Los cambios se realizan en SellAuth.'
          : 'Busca, filtra y edita los productos que el bot muestra en la tienda.'}
        status={`${productos.filter((producto) => producto.visible).length} de ${productos.length} visibles · ${fuente === 'sellauth' ? 'SellAuth' : 'local'}`}
        actions={fuente === 'local' ? <DialogoNuevoProducto categorias={categorias} /> : undefined}
      />
      {ordenados.length ? <CatalogTable productos={ordenados} categorias={categorias} editable={fuente === 'local'} /> : <CatalogEmpty />}
    </div>
  );
}
