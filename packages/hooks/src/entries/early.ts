import '../preload/recent-repositories'
import { installWslGitInterceptor } from '../preload/wsl/interceptor'
import { setupWslRepositoryDialogs } from '../preload/wsl/repository-dialogs'

installWslGitInterceptor()
setupWslRepositoryDialogs()
