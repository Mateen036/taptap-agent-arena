import {notFound} from 'next/navigation';
import {ui} from '../../ui/generated';
export default async function PublicPage({params}:{params:Promise<{publicPath:string[]}>}){const {publicPath:path}=await params;if(path.length!==2||!['agents','matches','runs','rounds'].includes(path[0]))notFound();return <div dangerouslySetInnerHTML={{__html:ui}}/>;}
